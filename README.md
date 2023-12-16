# PayMeBTC
This is a self hosted client to serve invoices to social media services and websites. It is currently only compatible with LND. You only need to run this program to receive payments via PayMeBTC, not send them.

# How To Run
To run PayMeBTC simply download the files and choose one of the three operating modes.

## Raw HTML Mode
This mode has zero included dependencies and requires only the PayMeBTC.html file. Simply open PayMeBTC.html and follow the instructions. You must have a LND node for this mode to work and you must manually configure it and PayMeBTC. You must also manually add your LND certificate to your certificate authority.

## Electron Mode
This mode uses the same PayMeBTC.html file but wraps it in electron to enable automation and quality of life features. Recommended for unsophisticated users. To use either download and run the [release](https://github.com/MrRGnome/PayMeBTC-client/releases) appropriate for your platform, or download the source and run `npm install` and then `npm start`.

## Headless Mode
This mode doesn't have a UI. Instead the application is configured using .env variables. You can place a .env file in the same directory as headless.js with the follow contents:

```
	lndip=localhost:8080
	macaroon=/home/your_username/.lnd/data/chain/bitcoin/mainnet/invoice.macaroon
	connectionStrings=connectionString1::connectionString2::connectionString3
```

To use headless mode make the above config then run `npm install` and `npm run headless`.