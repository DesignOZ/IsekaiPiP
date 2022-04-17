const electron = require("electron")
const path = require("path")
const { ElectronAuthProvider } = require("@twurple/auth-electron")
const {ApiClient} = require("@twurple/api")
const { app, BrowserWindow, ipcMain, Tray, Menu,session } = electron
const firstRun = require("electron-first-run");
const store = require("./store")
const {autoUpdater} = require("electron-updater");
require('@electron/remote/main').initialize();

const isFirstRun = firstRun()
const page_dir = path.join(__dirname, "/src/")
const clientId = "m65puodpp4i8bvfrb27k1mrxr84e3z" //공개돼도 되는 값.
const redirectUri = "http://localhost/"
const authProvider = new ElectronAuthProvider({
    clientId,
    redirectUri
})
const apiClient = new ApiClient({ authProvider });

const channel_name = ["viichan6", "gosegugosegu", "cotton__123", "lilpaaaaaa", "vo_ine", "jingburger"]
let mainWin, tray

global.backWin = null
global.PIPWin = null

function createMainWindow() {
    mainWin = new BrowserWindow({
        width: 756,
        height: 585,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            backgroundColor:"#0e0e10"
        },
        icon:path.join(page_dir, "assets/icon.jpg"),
        resizable:false
    })
    mainWin.setMenu(null);
    mainWin.loadFile(path.join(page_dir, "pages/main/index.html"));
    //mainWin.webContents.openDevTools()
    
    mainWin.on("closed", () => {
        mainWin = null;
    })
}

function createBackground(){
    backWin = new BrowserWindow({
        show:false,
        webPreferences: { 
            contextIsolation: false,
            nodeIntegration: true,
        }
    })
    
    backWin.webContents.openDevTools()
    backWin.loadFile(path.join(page_dir, "pages/background/index.html"));
}

function createPIPWin(){
    session.defaultSession.webRequest.onBeforeRequest({
        urls: [
          'https://embed.twitch.tv/*channel=*'
        ]
      }, (details, cb) => {
        var redirectURL = details.url;
    
        var params = new URLSearchParams(redirectURL.replace('https://embed.twitch.tv/',''));
        if (params.get('parent') != '') {
            cb({});
            return;
        }
        params.set('parent', 'locahost');
        params.set('referrer', 'https://localhost/');
    
        var redirectURL = 'https://embed.twitch.tv/?' + params.toString();
    
        cb({
          cancel: false,
          redirectURL
        });
      });
    
      // works for dumb iFrames
      session.defaultSession.webRequest.onHeadersReceived({
        urls: [
          'https://www.twitch.tv/*',
          'https://player.twitch.tv/*',
          'https://embed.twitch.tv/*'
        ]
      }, (details, cb) => {
        var responseHeaders = details.responseHeaders;
    
        delete responseHeaders['Content-Security-Policy'];
        //console.log(responseHeaders);
    
        cb({
          cancel: false,
          responseHeaders
        });
      });
    PIPWin = new BrowserWindow({
        width:480,
        height:270,
        webPreferences: { 
            contextIsolation: false,
            nodeIntegration: true,
        },
        frame:false,
        resizable:false,
        alwaysOnTop:true,
        x: 1390,
        y: 710
    })
    PIPWin.setMenu(null);
    require("@electron/remote/main").enable(global.PIPWin.webContents)
    PIPWin.loadFile(path.join(page_dir, "pages/pip/index.html"))
    PIPWin.on("closed", () => {
        PIPWin = null;
    })
}

app.on("ready", ()=>{
    createMainWindow();
    createBackground();
    tray = new Tray(path.join(page_dir, "assets/icon.jpg"));
    const contextMenu = Menu.buildFromTemplate([
        {label: "Exit", type: "normal", role: "quit"},
    ])
    tray.setToolTip("이세계 아이돌 트위치 방송 PIP");
    tray.setContextMenu(contextMenu)
    
    tray.on("click", () => {
        if(!mainWin) createMainWindow();
    })
    if(isFirstRun) store.store.set("order", channel_name);
    autoUpdater.checkForUpdatesAndNotify();
    //firstRun.clear()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
    if (backWin === null) createBackground();
    if (mainWin === null) createMainWindow();
})

ipcMain.on("getIsedolInfo", async (evt)=>{
    let info = []
    let res = await apiClient.users.getUsersByNames(channel_name)
        for(var i of res){
            let follows = await apiClient.users.getFollows({ followedUser: i.id, limit: 1 });
            let isStream = await apiClient.streams.getStreamByUserId(i.id)
            //let data = await apiClient.channels.getChannelInfo(i);
            info.push({"name":i.name, "displayName":i.displayName, "profile":i.profilePictureUrl, "id":i.id, "follows":follows.total, "isStream":isStream?true:false});
        }
        evt.returnValue = info
})

ipcMain.on("getOnePickStream", async (evt)=>{
    let isStream = await apiClient.streams.getStreamByUserName(store.store.get("order")[0])?true:false;
    if(isStream){
        createPIPWin();
        evt.sender.send("getOnePickStream_reply", isStream)
    }
})

ipcMain.on("closePIP", (evt) =>{
    evt.sender.send("getOnePickStream_reply", false)
    PIPWin.close();
})

ipcMain.on("isStreamOff", async (evt) => {
    let isStream = await apiClient.streams.getStreamByUserName(store.store.get("order")[0])?true:false;
    if(!isStream) evt.sender.send("isStreamOff_reply");
})

ipcMain.on("isStreamOffWhileOn", async (evt) => {
    let isStream = await apiClient.streams.getStreamByUserName(store.store.get("order")[0])?true:false;
    if(!isStream){
        evt.sender.send("isStreamOffWhileOn_reply");
        PIPWin.close();
    }
})

ipcMain.on("app_version", (evt) =>{
    evt.sender.send("app_version_reply", {version:app.getVersion()});
})

autoUpdater.on("update-downloaded", () => {
    mainWin.webContents.send("update_downloaded");
})

ipcMain.on("restart_app", () => {
    autoUpdater.quitAndInstall();
})