const { ipcRenderer } = require("electron");
const store = require("../../../store");

function docId(element){
    return document.getElementById(element);
}

const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
});

function window_close() {
    ipcRenderer.send("closePIP", params.name);
}

let video = document.createElement("video");
let hls = new Hls();
hls.loadSource(params.url);
hls.attachMedia(video);
hls.on(Hls.Events.MANIFEST_PARSED, ()=>{
    video.play();
});
docId("panel").append(video);

document.getElementById("volume").addEventListener("change", (e)=>{
    video.volume = e.target.value;
});

getStream = setInterval(()=>{
    ipcRenderer.send("isStreamOffWhileOn", params.name);
}, 30000);