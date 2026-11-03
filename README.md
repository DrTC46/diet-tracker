# Diet Tracker

A phone web app for following a diet. Log calories burned (from Garmin) and food by meal, see your deficit or surplus and its weight equivalent over any period, and get statistics and suggestions.

Your data stays on your phone. The only thing sent anywhere is a scanned barcode, to Open Food Facts.

## Run it on your computer

```
python -m http.server 8765 --bind 127.0.0.1
```

| Page | Address |
|---|---|
| App | http://127.0.0.1:8765/ |
| Tests | http://127.0.0.1:8765/tests/tests.html |
| Demo data (replaces local data with 60 days) | http://127.0.0.1:8765/tests/seed.html?go=stats |

The demo data page only works on a local server, so it can't overwrite real data on the published app.

## Put it on your phone

The camera and home-screen install both need HTTPS, so the app has to be hosted. GitHub Pages is free:

1. Create a GitHub repository and push this folder to it. The code is public on a free account, but your diet data is not in it.
2. In the repository, go to **Settings > Pages** and deploy from the `main` branch, root folder.
3. Open the published address on your phone.
4. Install it. On iPhone: Safari > Share > **Add to Home Screen**. On Android: Chrome menu > **Install app**.

## Back up your data

Deleting the app or losing the phone loses anything you haven't exported. Use **Settings > Export backup** and keep the file somewhere safe. The app reminds you after 14 days.

## Changing the app

There is no build step: edit the files and reload. Installed copies pick up changes on the launch after next. If you add or rename a file, add it to the list in `sw.js` and change `CACHE` there.

- `js/calc.js`: all the calculations
- `js/rules.js`: the Coach suggestions and their thresholds
- `js/views/`: one file per screen
