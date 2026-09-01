PH PathLabs - TallyPrime Bridge (Windows)
=========================================

This EXE runs ONLY on the PC where TallyPrime is open.
It does NOT poll. You click one button to download queued vouchers and push into Tally.

Install
-------
1. Run Install.bat
2. Desktop shortcut is created
3. Open the app, go to Settings:
   - Desktop API URL (already filled for PHPL cloud)
   - Desktop API Key = same DESKTOP_API_KEY used by WhatsApp Console
   - Tally host = http://localhost:9000
   - Tally company = exact company name in Tally
4. Save

Daily use
---------
1. Keep TallyPrime open with company loaded
2. In LIMS: Queue for Tally / Push to Tally
3. On this PC: open bridge -> Download & Push to Tally

Tally prerequisite
------------------
F1 > Settings > Connectivity > Client/Server Configuration
- TallyPrime act as = Server (or Both)
- Enable ODBC = Yes
- Port = 9000
