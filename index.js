const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')
const AdmZip                            = require('adm-zip')
const https                             = require('https')
const os                                = require('os')

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    }) 
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queryMap = {}
            
            new URL(uri).searchParams.forEach((v, k) => {
                queryMap[k] = v;
            });

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})


// ---------------------------------------------------------------------------
// Bundled JDK bootstrap.
// The game requires Java 25. Helios' built-in downloader fails inside the
// renderer (its got request dies silently and the await is missing), leaving
// the UI stuck at "Preparing Java Download.." 0%. So we provision the JDK in
// the MAIN process, into the exact folder Helios scans for local runtimes.
// ---------------------------------------------------------------------------
const JDK_MARKER   = 'jdk-25.0.5+8'
const JDK_ZIP_NAME = 'jdk25-win-x64.zip'
const JDK_URLS = [
    'https://github.com/wwa171/NB-Server/releases/download/latest/' + JDK_ZIP_NAME
]

function jdkRuntimeRoot() {
    const sysRoot = process.env.APPDATA ||
        (process.platform === 'darwin'
            ? path.join(process.env.HOME, 'Library', 'Application Support')
            : process.env.HOME)
    return path.join(sysRoot, '.helioslauncher', 'runtime', 'x64')
}

function jdkTargetPath() {
    return path.join(jdkRuntimeRoot(), JDK_MARKER)
}

function jdkIsInstalled() {
    return fs.existsSync(path.join(jdkTargetPath(), 'bin', 'javaw.exe'))
}

function downloadTo(url, dest) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'MajakgwiLauncher' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume()
                return downloadTo(res.headers.location, dest).then(resolve, reject)
            }
            if (res.statusCode !== 200) {
                res.resume()
                return reject(new Error('HTTP ' + res.statusCode + ' for ' + url))
            }
            const tmp = dest + '.part'
            const out = fs.createWriteStream(tmp)
            res.pipe(out)
            out.on('finish', () => out.close(() => {
                try { fs.renameSync(tmp, dest); resolve() } catch (e) { reject(e) }
            }))
            out.on('error', reject)
        })
        req.on('error', reject)
        req.setTimeout(120000, () => req.destroy(new Error('timeout')))
    })
}

async function ensureJdk(splash) {
    if (process.platform !== 'win32' || process.arch !== 'x64') return
    if (jdkIsInstalled()) {
        console.log('[JDK] already installed at ' + jdkTargetPath())
        return
    }

    const root = jdkRuntimeRoot()
    fs.mkdirSync(root, { recursive: true })
    const zipPath = path.join(root, JDK_ZIP_NAME)

    if (!fs.existsSync(zipPath)) {
        let lastErr = null
        for (const url of JDK_URLS) {
            try {
                if (splash) splash('Java 25 다운로드 준비 중..')
                console.log('[JDK] downloading ' + url)
                await downloadTo(url, zipPath)
                console.log('[JDK] downloaded ' + fs.statSync(zipPath).size + ' bytes')
                lastErr = null
                break
            } catch (e) {
                lastErr = e
                console.error('[JDK] download failed: ' + e.message)
            }
        }
        if (lastErr) throw lastErr
    } else {
        console.log('[JDK] using cached ' + zipPath)
    }

    if (splash) splash('Java 25 \uc555\ucd95 \ud574\uc81c \uc911..')
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    // Archives created on Windows use backslashes; normalise before splitting.
    const norm = e => String(e.entryName).replace(/\\/g, '/')
    const tops = new Set(entries.map(e => norm(e).split('/')[0]).filter(Boolean))
    const singleRoot = tops.size === 1 ? [...tops][0] : null
    const nested = singleRoot != null &&
        entries.every(e => { const n = norm(e); return n.includes('/') && n.split('/')[0] === singleRoot })

    if (nested) {
        // Archive already has one top-level folder: extract into the runtime root.
        zip.extractAllTo(root, true)
    } else {
        // Flat archive (or several roots): extract into the marker folder.
        const dest = jdkTargetPath()
        fs.mkdirSync(dest, { recursive: true })
        zip.extractAllTo(dest, true)
    }

    // Some archives nest twice (jdk-x/jdk-x/bin). Flatten that case.
    const dest = jdkTargetPath()
    if (!fs.existsSync(path.join(dest, 'bin', 'javaw.exe'))) {
        const subs = fs.readdirSync(dest, { withFileTypes: true }).filter(d => d.isDirectory())
        const hit = subs.find(d => fs.existsSync(path.join(dest, d.name, 'bin', 'javaw.exe')))
        if (hit) {
            const inner = path.join(dest, hit.name)
            for (const entry of fs.readdirSync(inner)) {
                fs.renameSync(path.join(inner, entry), path.join(dest, entry))
            }
            try { fs.rmdirSync(inner) } catch (err) { /* not empty, keep */ }
            console.log('[JDK] flattened nested folder ' + hit.name)
        }
    }

    if (!jdkIsInstalled()) {
        throw new Error('JDK extraction failed: javaw.exe not found after extract')
    }
    console.log('[JDK] ready at ' + jdkTargetPath())
    try { fs.unlinkSync(zipPath) } catch (e) { /* keep cache if locked */ }
}


// ---------------------------------------------------------------------------
// LWJGL native extraction.
// Helios does not understand the new per-classifier natives layout used by
// Minecraft 26.x, so `java.library.path` ends up invalid and the game dies with
// "UnsatisfiedLinkError: Failed to locate library: lwjgl.dll". We unpack every
// *-natives-windows.jar into the instance's natives folder and point the JVM at
// it via jvmOptions (the path is per-user, so it cannot live in the manifest).
// ---------------------------------------------------------------------------
function launcherRoot() {
    const sysRoot = process.env.APPDATA ||
        (process.platform === 'darwin'
            ? path.join(process.env.HOME, 'Library', 'Application Support')
            : process.env.HOME)
    return path.join(sysRoot, '.helioslauncher')
}

function instanceNativesDir(serverId) {
    return path.join(launcherRoot(), 'instances', serverId, 'natives')
}

function ensureNatives(serverId) {
    if (process.platform !== 'win32') return null

    const libDir = path.join(launcherRoot(), 'common', 'libraries')
    const natDir = instanceNativesDir(serverId)
    if (!fs.existsSync(libDir)) return null

    // Drop a previously extracted set so version conflicts cannot survive.
    const stampFile = path.join(natDir, '.extracted')
    const stampNow = 'v2'
    if (fs.existsSync(natDir)) {
        let prev = null
        try { prev = fs.readFileSync(stampFile, 'utf8').trim() } catch (e) { /* none */ }
        if (prev !== stampNow) {
            for (const e of fs.readdirSync(natDir)) {
                if (/\.dll$/i.test(e)) { try { fs.unlinkSync(path.join(natDir, e)) } catch (err) { /* locked */ } }
            }
        }
    }
    fs.mkdirSync(natDir, { recursive: true })

    const jars = []
    const walk = dir => {
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
        for (const e of entries) {
            const full = path.join(dir, e.name)
            if (e.isDirectory()) walk(full)
            else if (/-natives-windows\.jar$/i.test(e.name)) jars.push(full)
        }
    }
    walk(libDir)

    // Two LWJGL generations can be present (3.3.x from the vanilla manifest and
    // 3.4.x from the new per-classifier layout). Only the newest version of each
    // native may land in the folder: the older lwjgl.dll lacks symbols the newer
    // bindings call (MemoryUtil.ngetPageSize), which crashes the game.
    const jarVersion = f => {
        const m = path.basename(f).match(/-(\d+)\.(\d+)\.(\d+)(?:-[^.]+)?-natives-windows\.jar$/i)
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
    }
    jars.sort((a, b) => {
        const va = jarVersion(a), vb = jarVersion(b)
        for (let i = 0; i < 3; i++) { if (va[i] !== vb[i]) return vb[i] - va[i] }
        return a.localeCompare(b)
    })

    let extracted = 0
    const written = new Set()
    for (const jar of jars) {
        try {
            const zip = new AdmZip(jar)
            for (const entry of zip.getEntries()) {
                const name = entry.entryName.split(/[\\/]/).pop()
                if (!/\.dll$/i.test(name)) continue
                // Newest jar wins: later (older) jars must not overwrite.
                if (written.has(name.toLowerCase())) continue
                const target = path.join(natDir, name)
                fs.writeFileSync(target, zip.readFile(entry))
                written.add(name.toLowerCase())
                extracted++
            }
        } catch (e) {
            console.error('[NATIVES] failed on ' + path.basename(jar) + ': ' + e.message)
        }
    }
    try { fs.writeFileSync(stampFile, stampNow, 'utf8') } catch (e) { /* ignore */ }
    if (extracted > 0) console.log('[NATIVES] extracted ' + extracted + ' dll(s) into ' + natDir)
    return natDir
}

/**
 * Make sure the selected server's jvmOptions contain a correct
 * -Djava.library.path pointing at the instance natives folder.
 */
function ensureLibraryPathOption(serverId) {
    const natDir = instanceNativesDir(serverId)
    if (!fs.existsSync(path.join(natDir, 'lwjgl.dll'))) return false

    const cfgPath = path.join(launcherRoot(), '..', 'Helios Launcher', 'config.json')
    const altPath = path.join(app.getPath('userData'), 'config.json')
    const candidates = [altPath, cfgPath].filter(p => fs.existsSync(p))
    if (candidates.length === 0) return false

    let touched = false
    for (const cfgFile of candidates) {
        let cfg
        try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch (e) { continue }
        const jc = cfg.javaConfig && cfg.javaConfig[serverId]
        if (!jc) continue
        const opts = Array.isArray(jc.jvmOptions) ? jc.jvmOptions : []
        const filtered = opts.filter(o => !String(o).startsWith('-Djava.library.path='))
        filtered.push('-Djava.library.path=' + natDir)
        if (JSON.stringify(filtered) !== JSON.stringify(opts)) {
            jc.jvmOptions = filtered
            fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 4), 'utf8')
            touched = true
            console.log('[NATIVES] updated jvmOptions in ' + cfgFile)
        }
    }
    return touched
}

const DEFAULT_SERVER_ID = 'majakgwi-26.3'

function bootstrapNatives() {
    try {
        ensureNatives(DEFAULT_SERVER_ID)
        ensureLibraryPathOption(DEFAULT_SERVER_ID)
    } catch (e) {
        console.error('[NATIVES] bootstrap failed: ' + e.message)
    }
}

function showSplash() {
    const splash = new BrowserWindow({
        width: 420,
        height: 190,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        backgroundColor: '#171614',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    const html = '<html><body style="margin:0;background:#171614;color:#e8e6e3;' +
        'font-family:Segoe UI,sans-serif;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;height:100vh">' +
        '<div style="font-size:15px;font-weight:600">마작귀 런처</div>' +
        '<div id="msg" style="margin-top:14px;font-size:12px;color:#9a9a9a">Java 25 확인 중..</div>' +
        '</body></html>'
    splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return {
        set(text) {
            if (splash.isDestroyed()) return
            splash.webContents.executeJavaScript(
                'var m=document.getElementById("msg");if(m)m.textContent=' + JSON.stringify(text)
            ).catch(() => {})
        },
        close() { if (!splash.isDestroyed()) splash.destroy() }
    }
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createMenu)

app.on('ready', async () => {
    let splash = null
    try {
        bootstrapNatives()
        if (process.platform === 'win32' && process.arch === 'x64' && !jdkIsInstalled()) {
            splash = showSplash()
            await ensureJdk(text => splash && splash.set(text))
        }
    } catch (err) {
        console.error('[JDK] bootstrap failed:', err)
        if (splash) splash.set('Java 25 준비 실패: ' + err.message)
        await new Promise(r => setTimeout(r, 4000))
    } finally {
        if (splash) splash.close()
    }
    createWindow()
})

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
