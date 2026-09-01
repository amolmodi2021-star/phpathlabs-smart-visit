# TallyPrime bridge (Windows EXE, no polling)

## Download / install
1. Get the release zip `PHPathLabs-TallyBridge-Setup.zip`
2. Extract and run **Install.bat**
3. Desktop shortcut opens the bridge UI at http://127.0.0.1:8787

## Build (developers)
```bat
cd scripts\tally-bridge
npm install
npm run build:exe
```

## Config
`tally-bridge.config.json` next to the EXE (also editable in the UI Settings page).
