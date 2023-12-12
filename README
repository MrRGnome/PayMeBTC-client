# PayMeBTC
This is a self hosted client to serve invoices to social media services and websites. It is currently only compatible with LND.

# How To Run
To run PayMeBTC simply download the files and choose one of the three operating modes.

## Raw HTML Mode
This mode has zero included dependancies and requires only the PayMeBTC.html file. Simply open it and follow the instructions. You must have a LND node for this mode to work and you must manually configure it and PayMeBTC.

## Electron Mode
This mode uses the same PayMeBTC.html file but wraps it in electron to enable automation and quality of life features. Recommended for unsophisticated users.

## Headless Mode
This mode is identical to Electron Mode except it does not include a UI. Instead the application is configures using .env variables. You can place a .env file in the same directory as PayMEBTC.html with the follow contents:

```
	headless=True
	connectionStrings=connectionString1 connectionString2 connectionString3
```