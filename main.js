const path = require('path');
const { downloadRelease } = require('@terascope/fetch-github-release');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain } = require("electron");
require('dotenv').config();

app.commandLine.appendSwitch('ignore-certificate-errors');
app.whenReady().then(() => {
        createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    })
    
});
function createWindow () {
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
function downloadLND () {
    
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
        let oldPath = "";
        switch(process.platform) {
            case 'linux', 'darwin':
                console.log("installing LND for linux and macos");
                let unzip = spawn("tar -xvzf " + data[0] + " -C " + path.join(__dirname, 'lnd'));
                n=0
                unzip.stdout.on('data', data => {
                    console.log(`stdout:\n${data}`);
                    if(n==0)
                        startLND();
                    n++;

                });
                
                unzip.stderr.on('data', data => {
                    console.error(`stderr: ${data}`);
                });
                
                break;
            case 'win32':
                console.log("installing LND for windows");
                oldPath = data[0].match(/.*\./)[0];
                oldPath = oldPath.slice(0, oldPath.length -1);
                fs.readdirSync(oldPath).forEach((file) => {
                    fs.copyFileSync(path.join(oldPath, file), path.join(__dirname, 'lnd', file));
                    console.log(`Copied ${path.join(oldPath, file)} to ${ path.join(__dirname, 'lnd', file)}`);
                });
                fs.rmSync(oldPath, { recursive: true, force: true });
                startLND();
                break;
        }
        
    })
    .catch(function(err) {
        console.error(err.message);
    });
};
function startLND (data) {
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
function autoDetectMacaroon () {
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
