const electron = require("electron");
const path = require("path");
const { ElectronAuthProvider } = require("@twurple/auth-electron");
const { ApiClient } = require("@twurple/api");
const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell } = electron;
const store = require("./store");
const { autoUpdater } = require("electron-updater");
const twitch = require("./lib.js");
const config = require("./config.json");
const { redactedFunc } = require("./redacted.js");

const page_dir = path.join(__dirname, "/src/");
const clientId = config["CLIENT_ID"];
const redirectUri = config["REDIRECT_URI"];
const authProvider = new ElectronAuthProvider({
    clientId,
    redirectUri,
});
const apiClient = new ApiClient({ authProvider });

const lock = app.requestSingleInstanceLock();

let mainWin;
let tray;
let backWin;
let PIPWin = {};
let trayIcon;
let pointsWin = {};

function createMainWindow() {
    mainWin = new BrowserWindow({
        width: 756,
        height: 585,
        frame: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            backgroundColor: "#0e0e10",
        },
        icon: path.join(page_dir, "assets/icon.png"),
        resizable: false,
    });
    mainWin.setMenu(null);
    mainWin.loadFile(path.join(page_dir, "pages/main/index.html"));
    autoUpdater.checkForUpdates();
    mainWin.on("closed", () => {
        mainWin = null;
    });
    mainWin.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
}

function createBackground() {
    backWin = new BrowserWindow({
        show: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
        },
    });

    backWin.loadFile(path.join(page_dir, "pages/background/index.html"));
}

function createPIPWin(url, name) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    PIPWin[name] = new BrowserWindow({
        width: 480,
        height: 270,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
        },
        frame: false,
        resizable: true,
        maximizable: false,
        skipTaskbar: true,
        x: width - 530,
        y: height - 320,
    });
    PIPWin[name].setAspectRatio(16 / 9);
    PIPWin[name].setMenu(null);
    PIPWin[name].loadURL("file://" + path.join(page_dir, `pages/pip/index.html?url=${url}&name=${name}`));
    PIPWin[name].setAlwaysOnTop(true, "screen-saver");
    PIPWin[name].setVisibleOnAllWorkspaces(true);

    if (store.store.get("channelPoints")) createPointsWin(name);
}

function createPointsWin(name){
    pointsWin[name] = new BrowserWindow({
        show: false,
    });
    pointsWin[name].loadURL("https://twitch.tv/" + name);
    pointsWin[name].webContents.setAudioMuted(true);
    pointsWin[name].webContents.executeJavaScript(
        `setInterval(()=>{
        const box = document.querySelector("#live-page-chat > div > div > div > div > div > section > div > div.Layout-sc-1xcs6mc-0.bGyiZe.chat-input > div:nth-child(2) > div.Layout-sc-1xcs6mc-0.XTygj.chat-input__buttons-container > div.Layout-sc-1xcs6mc-0.hROlnu > div > div > div > div.Layout-sc-1xcs6mc-0.CDgpA > div > div > div > button");
        if(box) {
            box.click();
        }
        }, 30000);`
    );
}

if(!lock){
    app.quit();
} else{
    app.on("second-instance",() => {
        if(mainWin){
            if(mainWin.isMinimized() || !mainWin.isVisible()) mainWin.show();
            mainWin.focus();
        }else if(!mainWin){
            createMainWindow();
        }
    });
}

app.on("ready", () => {
    store.store.delete("order"); //test
    if (!store.store.get("order")){
        store.store.set("order", config["CHANNEL_NAME"]);
        app.setLoginItemSettings({
            openAtLogin: true
        });
    }
    if (store.store.get("channelPoints") === undefined) store.store.set("channelPoints", true);
    createMainWindow();
    createBackground();
    trayIcon = (process.platform === "darwin")?"assets/icon2.png":"assets/icon.png";
    tray = new Tray(path.join(page_dir, trayIcon));
    const contextMenu = Menu.buildFromTemplate([
        { label: "Exit", type: "normal", role: "quit" },
    ]);
    tray.setToolTip(config["TOOLTIP_NAME"]);
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
        if (!mainWin) createMainWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (backWin === null) createBackground();
    if (mainWin === null) createMainWindow();
});

ipcMain.on("getIsedolInfo", async (evt) => {
    const info = [];
    const res = await apiClient.users.getUsersByNames(config["CHANNEL_NAME"]);
    for (const i of res) {
        const follows = await apiClient.users.getFollows({ followedUser: i.id, limit: 1 });
        const isStream = await apiClient.streams.getStreamByUserId(i.id);
        // let data = await apiClient.channels.getChannelInfo(i);
        info.push({ "name": i.name,
            "displayName": i.displayName,
            "profile": i.profilePictureUrl,
            "id": i.id,
            "follows": follows.total,
            "isStream": isStream ? true : false });
    }
    backWin.webContents.send("login");
    evt.returnValue = info;
});

ipcMain.on("getOnePickStream", async (evt) => {
    const isStream = await apiClient.streams.getStreamByUserName(store.store.get("order")[ 0 ]) ? true : false;
    if (isStream) {
        const redacted = await redactedFunc();
        await twitch.getStream(store.store.get("order")[ 0 ], false, redacted).then((res) => {
            createPIPWin(res[ 0 ].url, store.store.get("order")[0]);
        });
        evt.sender.send("getOnePickStream_reply", isStream);
    }
});

ipcMain.on("openSelectPIP", async (evt, arg) => {
    if (PIPWin[arg]) {
        PIPWin[arg].focus();
        return;
    }
    const isStream = await apiClient.streams.getStreamByUserName(arg) ? true : false;
    if(isStream){
        const redacted = await redactedFunc();
        if (arg === store.store.get("order")[ 0 ]) backWin.webContents.send("getOnePickStream_reply");
        await twitch.getStream(arg, false, redacted).then((res) => {
            createPIPWin(res[0].url, arg);
        });
    }
});

ipcMain.on("closePIP", (evt, arg) => {
    if(arg === store.store.get("order")[ 0 ])
        backWin.webContents.send("PIPClose");
    PIPWin[arg].close();
    PIPWin[arg] = null;
    if (store.store.get("channelPoints")) {
        pointsWin[arg].close();
        pointsWin[arg] = null;
    }
});

ipcMain.on("isStreamOff", async (evt) => {
    const isStream = await apiClient.streams.getStreamByUserName(store.store.get("order")[ 0 ]) ? true : false;
    if (!isStream) evt.sender.send("isStreamOff_reply");
});

ipcMain.on("isStreamOffWhileOn", async (evt, arg) => {
    const isStream = await apiClient.streams.getStreamByUserName(arg) ? true : false;
    if (!isStream) {
        backWin.webContents.send("isStreamOff_reply");
        PIPWin[arg].close();
        PIPWin[arg] = null;
        if (store.store.get("channelPoints")) {
            pointsWin[arg].close();
            pointsWin[arg] = null;
        }
    }
});

ipcMain.on("app_version", (evt) => {
    evt.sender.send("app_version_reply", { version: app.getVersion() });
});

autoUpdater.on("update-downloaded", () => {
    mainWin.webContents.send("update_downloaded");
});

ipcMain.on("restart_app", () => {
    autoUpdater.quitAndInstall();
});

ipcMain.on("getChannelPoints", (evt) => {
    store.store.set("channelPoints", !store.store.get("channelPoints"));
});

ipcMain.once("openPIPWithAppOpen", async () => {
    if (await apiClient.streams.getStreamByUserName(store.store.get("order")[ 0 ]) ? true : false) {
        const redacted = await redactedFunc();
        await twitch.getStream(store.store.get("order")[ 0 ], false, redacted).then((res) => {
            createPIPWin(res[ 1 ].url, store.store.get("order")[0]);
        });
        backWin.webContents.send("getOnePickStream_reply", true);
    }
});

ipcMain.on("closeMainWin", () => {
    mainWin.close();
    mainWin = null;
});

ipcMain.on("minimizeMainWin", () => {
    mainWin.minimize();
});