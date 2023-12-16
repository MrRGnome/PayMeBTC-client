const {hmacMsg, hmacUnMsg} = require('./hmac.js');
const { WebSocket } = require("ws");
const { Agent, setGlobalDispatcher } = require('undici');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

process.env.NODE_NO_WARNINGS=1

const agent = new Agent({
	connect: {
		rejectUnauthorized: false
	}
});

setGlobalDispatcher(agent);

let window;

let SETTINGS = {
    macaroon: undefined,
    lndip: '127.0.0.1:8080',
    sockets: {},
    services: {}
};

startHeadless()

function startHeadless() {

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
and connectionStrings::yourConnectionString::anotherConnectionString

Your current configuration reads as:
macaroon=` + process.env.macaroon + `
lndip=` + process.env.lndip + `
connectionStrings=` + process.env.connectionStrings + `
`);

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
        console.error("Error from " + service.url + ": " + event);
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