const path = require('path');
const { app, BrowserWindow, ipcMain } = require("electron");
const { downloadRelease } = require('@terascope/fetch-github-release');
const fs = require('fs');
const { spawn } = require('child_process');
const {hmacMsg, hmacUnMsg} = require('./hmac.js');
const { WebSocket } = require("ws");
const { Agent, setGlobalDispatcher } = require('undici');

const agent = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

setGlobalDispatcher(agent);

app.commandLine.appendSwitch('ignore-certificate-errors');

let window;

let SETTINGS = {
    macaroon: undefined,
    lndip: '127.0.0.1:8080',
    sockets: {},
    services: {}
};

app.whenReady().then(() => {
    if (process.env.headless) {
        startHeadless();
    }
    else {
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0)
                createWindow();
        })
    }
});

const startHeadless = () => {

    //cli format npm start <envVariableName>=<value>
    for(let i = 2; i < process.argv.length; i++) {
        let arg = process.argv[i].split("::");
        if(arg.length == 2)
            process.env[arg[0]] = arg[1];
    }

    if(!process.env.macaroon || !process.env.connectionStrings || !process.env.lndip)
        return console.error(`Missing .env variable or cli arguments. Mandatory options to include in your .env file or cli include: 
macaroon=path/to/your/macaroon/invoice.macaroon 
lndip::127.0.0.1:8080 or your LND IP:PORT
and connectionStrings::yourConnectionString>>anotherConnectionString`);

    SETTINGS.lndip = process.env.lndip;

    fs.readFile(process.env.macaroon, 'hex', async function (err, data) {
        if (err) {
            console.error(err);
            return;
        }
        if(!data) {
            console.error("Could not auto-detect LND Macaroon files.");
            return;
        }

        SETTINGS.macaroon = data;

        try {
            let results = await call("GET", "https://" + SETTINGS.lndip + "/v1/state");
            results = await results.json();
            switch(results.state) {
                case "NON_EXISTING":
                    console.warn("Your wallet hasn't been created yet, please run 'lncli create'.");
                    break;
                case "WAITING_TO_START":
                    console.warn("Waiting for lnd cluster.");
                    break;
                case "LOCKED":
                    console.warn("Your wallet is currently locked. Please unlock it. ");
                    break;
                case "UNLOCKED":
                    console.warn("Your wallet is unlocked but the server is still starting. ");
                    break;
                case "RPC_ACTIVE":
                    console.warn("The LND server is still starting and not ready for calls. ");
                    break;
                case "SERVER_ACTIVE":
                    console.warn("The LND server is ready for calls. ");
                    break;
            }
        }
        catch(ex) {
            console.error(ex);
            console.error("Unable to contact LND server. Make sure macaroon and lndip are correct. Current values - macaroon: " + process.env.macaroon + " lndip: " + process.env.lndip);
        }
    });

    let connectionStrings = process.env.connectionStrings.split(">>");

    for(let i = 0; i <connectionStrings.length; i++) {
        let connectionComponents = connectionStrings[i].split(">");
        if(connectionComponents.length == 3) {
            let service = {url: connectionComponents[0], auth_code: connectionComponents[1], id: connectionComponents[2]}
            let socket = startSocket(service);
            
        }
        else 
            console.warn("Invalid connection string: " + connectionComponents);
    }

    

}

async function startSocket(service) {
    let msg = {timestamp: Date.now(), id:service.id};
    let hmacJson = await hmacMsg(service.auth_code, msg);
    let qryString = "cs=" + encodeURIComponent(btoa(JSON.stringify(hmacJson)));
    let preCharacter = "";
    if(service.url.includes("?")) {
        preCharacter = "&";
    }else {
        preCharacter = "?";
    }

    const socket = new WebSocket(service.url + preCharacter + qryString);
    SETTINGS.sockets[service.url] = socket;
    SETTINGS.services[service.url] = service;
    SETTINGS.services[service.url].socket = socket;
    SETTINGS.services[service.url].reconInterval = "unset";

    socket.on('open', function (event) {
        if(SETTINGS.services[service.url].reconInterval != "unset") {
            console.log("Reconnected to " + service.url)
            clearInterval(SETTINGS.services[service.url].reconInterval);
        } else {
            console.log("Connection open to " + service.url)
        }
    });

    socket.on('close', function (event) {
        console.warn("The connection to " + service.url + " was closed. Attempting reconnection every 60s.")
        SETTINGS.services[service.url].reconInterval = setInterval(() => {
            ConnectService(service);
        }, 60000);
    });

    socket.on('error', function (event) {
        console.error("Error from " + service.url + ": " + JSON.stringify(event));
    });

    socket.on('message', function (event) {
        var msg;
        try {
            //console.log(event);
            msg = JSON.parse(event.data);
        }
        catch (e){
            return console.log("Invalid JSON in message resceived: " + event);
        }

        if(!msg.action)
            return console.log("No action property in received message: " + event);
        console.log("Message from " + event.origin + ": " + event.data);

        //All the websocket server interactions here
        switch(msg.action) {
            case 'new_invoice':
                newInvoice(msg.amount ? msg.amount : 0, msg.memo ? msg.memo : service.url + " - " + service.id + " tip for " + msg.amount).then(invoice => {
                    if(!invoice || !invoice.payment_request) {
                        console.warn("Was unable to get invoice from LND, possible macaroon related issue");
                        return;
                    }
                    hmacMsg(service.auth, {id: service.id, action: "new_invoice", data: invoice.payment_request, requestId: msg.requestId, amount: msg.amount}).then(hmac => {
                        socket.send(JSON.stringify(hmac));
                    })
                })
                break;
        }
    });
}

async function newInvoice(sats = 0, memo = "Tip Request") {
    let requestBody = {
        memo: memo,
        //r_preimage: <string>, // <bytes> (base64 encoded)
        //r_hash: <string>, // <bytes> (base64 encoded)
        value: sats,
        //value_msat: <string>, // <int64> 
        //settled: <boolean>, // <bool> 
        //creation_date: <string>, // <int64> 
        //settle_date: <string>, // <int64> 
        //payment_request: <string>, // <string> 
        //description_hash: <string>, // <bytes> (base64 encoded)
        //expiry: <string>, // <int64> 
        //fallback_addr: <string>, // <string> 
        //cltv_expiry: <string>, // <uint64> 
        //route_hints: <array>, // <RouteHint> 
        private: true,
        //add_index: <string>, // <uint64> 
        //settle_index: <string>, // <uint64> 
        //amt_paid: <string>, // <int64> 
        //amt_paid_sat: <string>, // <int64> 
        //amt_paid_msat: <string>, // <int64> 
        //state: <string>, // <InvoiceState> 
        //htlcs: <array>, // <InvoiceHTLC> 
        //features: <object>, // <FeaturesEntry> 
        //is_keysend: <boolean>, // <bool> 
        //payment_addr: <string>, // <bytes> (base64 encoded)
        //is_amp: <boolean>, // <bool> 
        //amp_invoice_state: <object>, // <AmpInvoiceStateEntry>
    };

    let res = await call("POST", "https://" + SETTINGS.lndip + "/v1/invoices", requestBody);
    let resJson = await res.json();
    return resJson;
};

async function call(method, url, body) {
    let options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Grpc-Metadata-macaroon': SETTINGS.macaroon
        },
        referrerPolicy: "no-referrer",
        mode: "cors"
    };

    if(method == "POST")
        options.body = JSON.stringify(body);
    return fetch(url, options);
}

const createWindow = () => {
    const preloadScriptPath = path.join(__dirname, 'preload.js');
    let browserObj = {
        width: 1200,
        height: 900,
        webPreferences: {
            contextIsolation: true,
            preload: preloadScriptPath
        }
    }
    const win = new BrowserWindow(
        browserObj
    );
    
    win.loadFile('PayMeBTC.html');

    //Open links externally
    win.webContents.setWindowOpenHandler((details) => {
        require('electron').shell.openExternal(details.url);
        return { action: 'deny' };
    });
    
    //cache window for messaging later
    window = win;

    ipcMain.handle('call', async function call(_event, data) {
        switch(data.action) {
            case 'downloadLND':
                downloadLND();
            break;
            case 'startLND':
                startLND(data);
            break;
            case 'autoDetectMacaroon':
                autoDetectMacaroon();
            break;
            case 'loadConnectionStrings':
                window.webContents.send('functionOutput', {action: 'setConnectionStrings', result: process.env.connectionStrings ? process.env.connectionStrings : ""});
            break;
        }
    })
};

//Accomodate mac because they "think different".
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});

const downloadLND = () => {
    
    let user = 'lightningnetwork';
    let repo = 'lnd';

    function filterRelease(release) {
        // Filter out prereleases.
        return release.prerelease === false;
    }

    let filters = [];

    switch(process.arch) {
        case 'x32':
            filters.push('386');
            //console.log("32-bit extended systems");
            break;
        case 'x64':
            filters.push('amd64');
            //console.log("64-bit extended systems");
            break;
        case 'arm':
            filters.push('arm-');
            //console.log("32-bit  Advanced RISC Machine");
            break;
        case 'arm64':
            filters.push('arm64');
            //console.log("64-bit  Advanced RISC Machine");
            break;
        case 's390':
            filters.push('s390');
            //console.log("31-bit The IBM System/390, the "
            //            + "third generation of the System/360"
            //            + " instruction set architecture");
            break;
        case 's390x':
            filters.push('s390');
            //console.log("64-bit The IBM System/390, the "
            //            + "third generation of the System/360"
            //            + " instruction set architecture");
            break;
        case 'mipsel':
            filters.push('mipsel');
            //console.log("64-bit Microprocessor without "
            //            + "Interlocked Pipelined Stages");
            break;
        case 'mips':
            filters.push('mips-');
            //console.log("32-bit Microprocessor without "
            //            + "Interlocked Pipelined Stages");
            break;
        case 'ia32':
            filters.push('386');
            //console.log("32-bit Intel Architecture");
            break;
        case 'ppc64le':
            filters.push('ppc64le');
            //console.log("PowerPC Architecture.");
            break;
        case 'ppc64':
            filters.push('ppc64-');
            //console.log("64-bit PowerPC Architecture.");
            break;
    }

    switch(process.platform) {
        case 'darwin':
            filters.push('darwin');
            //MacOS
            break;
        case 'freebsd':
            filters.push('freebsd');
            break;
        case 'linux':
            filters.push('linux');
            break;
        case 'openbsd':
            filters.push('openbsd');
            break
        case 'win32':
            filters.push('windows');
            break;
    }
    function filterAsset(asset) {
        //select only downloads that mention our filters
        for(let i = 0; i < filters.length; i++){
            console.log(filters[i]);
            console.log(asset.name.includes(filters[i]));
            if(!asset.name.includes(filters[i])) {
                console.log("returning false");
                return false;
            }
        }
        return true;
    }
    downloadRelease(user, repo, path.join(__dirname, 'lnd'), filterRelease, filterAsset, false, false)
    .then(function(data) {
        console.log('Downloaded LND to ' + data[0]);
        console.log(data[0].match(/.*\./)[0]);
        let oldPath = data[0].match(/.*\./)[0];
        oldPath = oldPath.slice(0, oldPath.length -1);
        fs.readdirSync(oldPath).forEach((file) => {
            fs.copyFileSync(path.join(oldPath, file), path.join(__dirname, 'lnd', file));
            console.log(`Copied ${path.join(oldPath, file)} to ${ path.join(__dirname, 'lnd', file)}`);
        });
        fs.rmSync(oldPath, { recursive: true, force: true });
        startLND();
    })
    .catch(function(err) {
        console.log(err);
        console.error(err.message);
    });
};

const startLND = (data) => {
    if(!data || !data.args)
        data = { args: ["--bitcoin.active", "--bitcoin.mainnet", "--bitcoin.node=neutrino", "--feeurl=https://nodes.lightning.computer/fees/v1/btc-fee-estimates.json", "--restcors=*"]}

    //Now windows wants to "think different"
    let exe = process.platform == "win32" ? ".exe" : "";
    try {
        let lnd = spawn(path.join(__dirname, 'lnd', 'lnd' + exe), data.args);
        lnd.stdout.on('data', data => {
            console.log(`stdout:\n${data}`);
            window.webContents.send('lndOutput', data);
        });
        
        lnd.stderr.on('data', data => {
            console.error(`stderr: ${data}`);
            window.webContents.send('lndOutput', data);
        });
        window.webContents.send('functionOutput', {action: 'lndDetected', result: true});
    }
    catch(err) {
        //no lnd process installed
        window.webContents.send('functionOutput', {action: 'lndDetected', result: false});
    }
}

const autoDetectMacaroon = () => {
    //autodetect macaroon files
    if(process.env.macaroon){
        fs.readFile(process.env.macaroon, 'hex', (err, data) => {
            if (err) {
                console.error(err);
                return;
            }
            if(!data) {
                console.log("Could not auto-detect LND Macaroon files, please use the file selector below to find them.");
                return;
            }
            window.webContents.send('functionOutput', {action: 'setMacaroon', result: data});
        });
    }
    else {
        switch(process.platform) {
            case 'darwin':
                //MacOS 
                // ~/Library/Application Support/Lnd/

                fs.readFile(path.join('~', 'Library', 'Application Support', 'Lnd', 'data', 'chain', 'bitcoin', 'mainnet', 'admin.macaroon'), 'hex', (err, data) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    if(!data) {
                        console.log("Could not auto-detect LND Macaroon files, please use the file selector below to find them.");
                        return;
                    }
                    window.webContents.send('functionOutput', {action: 'setMacaroon', result: data});
                });
                
                break;
            case 'linux':
                // ~/.lnd/data
                fs.readFile(path.join('~', '.lnd', 'data', 'chain', 'bitcoin', 'mainnet', 'admin.macaroon'), 'hex', (err, data) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    if(!data) {
                        console.log("Could not auto-detect LND Macaroon files, please use the file selector below to find them.");
                        return;
                    }
                    window.webContents.send('functionOutput', {action: 'setMacaroon', result: data});
                });
                break;
            case 'win32':
                //even non32
                // %LOCALAPPDATA%\Lnd\data\chain\bitcoin\mainnet\admin.macaroon
                fs.readFile(path.join(process.env.LOCALAPPDATA, 'Lnd', 'data', 'chain', 'bitcoin', 'mainnet', 'admin.macaroon'), 'hex', (err, data) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    if(!data) {
                        console.log("Could not auto-detect LND Macaroon files, please use the file selector below to find them.");
                        return;
                    }
                    window.webContents.send('functionOutput', {action: 'setMacaroon', result: data});
                });
                break;
        }
    }
}
