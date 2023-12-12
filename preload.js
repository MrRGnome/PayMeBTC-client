const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('API', {
    call: (args) => {
        ipcRenderer.invoke('call', args)
    },
    onLndOutput: (callback) => ipcRenderer.on('lndOutput', callback),
    onFunctionOutput: (callback) => ipcRenderer.on('functionOutput', callback)
});

