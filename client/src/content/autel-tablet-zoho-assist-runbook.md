# Autel Tablet Remote Access Runbook

2026-10-03 · Mark Fowler

## Overview

Zoho Assist unattended access lets the office or a senior tech see and drive a field tablet without anyone tapping Accept on it. Autel tablets (MS909, IM608 and the other Android-based units) have no Google Play Store, so the Zoho apps are sideloaded from files we keep in WorkDrive. Setup takes about 20 minutes per tablet.

| Piece | What it does | Where it comes from |
| --- | --- | --- |
| APKMirror Installer | Installs the bundled (.apkm) Zoho app on a tablet with no Play Store | WorkDrive · Absolute ADAS Command Center > 01_Ops > Autel Setup > Zoho Assist, or [APKMirror Installer (Official)](https://www.apkmirror.com/apk/apkmirror/apkmirror-installer-official/) |
| Zoho Assist Customer App | The agent that keeps the tablet reachable | Same folder, 1.48 bundle (1.37.2 plain APK as a fallback), or [Customer App - Zoho Assist on APKMirror](https://www.apkmirror.com/apk/zoho-corporation/customer-app-zoho-assist/) |
| Zoho Assist Universal Add-on | Turns view-only into full remote control | Same folder |
| Zoho Assist console | Where you enroll, name, connect and manage tablets | https://assist.zoho.com/portal/absoluteadas/app/home, or the Zoho Assist phone app |

Two rules. We already pay for Zoho Assist, so no TeamViewer for Autel's built-in Remote Desk. And the only safe sources for these files are our WorkDrive folder and APKMirror, where they are verified as signed by Zoho. Never pull Zoho apps from any other APK site.

## What you need

- The Autel tablet, charged and on Wi-Fi
- The Zoho Assist console open on your laptop or phone
- A mouse for your laptop (recommended for the test in Step 7)

## Step 1: Start clean

- [ ] On the tablet, go to Settings > Apps and uninstall any Zoho Assist app already on it.
- [ ] Restart the tablet.

## Step 2: Allow installs from files

- [ ] Android 7: Settings > Security > Unknown sources > On.
- [ ] Android 8 and newer: Settings > Apps > Special access > Install unknown apps, then allow the browser and the file manager.

## Step 3: Get the files

- [ ] In the tablet's browser, open the WorkDrive folder Absolute ADAS Command Center > 01_Ops > Autel Setup > Zoho Assist, or scan the QR code posted in the shop.
- [ ] Download all four files:
  - 1_APKMirror-Installer.apk
  - 2_Zoho-Customer-1.48.apkm
  - 2b_Zoho-Customer-1.37.2.apk (fallback only)
  - 3_Zoho-Universal-Addon.apk

## Step 4: Install, in this order

- [ ] Tap 1_APKMirror-Installer.apk and install it.
- [ ] Open APKMirror Installer > Browse files > Downloads > 2_Zoho-Customer-1.48.apkm > Install package > Install. Skip or wait out the ad if one appears.
- [ ] If the bundle fails, tap 2b_Zoho-Customer-1.37.2.apk and install it directly. Update to the newest version later.
- [ ] Tap 3_Zoho-Universal-Addon.apk and install it. Without the add-on you can see the screen but not control it.

## Step 5: Grant every permission

Accept every prompt Zoho shows. If one was skipped, set it by hand:

- [ ] Accessibility: Settings > Accessibility > Zoho Assist Universal Add-on > On
- [ ] Device administrator: Activate
- [ ] Display over other apps: On
- [ ] Battery: Allow / Unrestricted. Skip this and the tablet drops offline.
- [ ] Notifications: Allow

## Step 6: Enroll the tablet

- [ ] In the console go to Unattended Access > Deployment > Android and copy the deployment link.
- [ ] Email the link to the tablet.
- [ ] On the tablet, open the link with the Customer App. If nothing happens, restart the tablet and open it again, or press and hold the link > Open with > Customer App.
- [ ] Tap Yes to enroll.
- [ ] Open the Customer App and confirm it says Unattended access is enabled.

## Step 7: Name it and test it

- [ ] In the console, rename the device so anyone can tell whose it is: Autel MS909 - Jayden Van, Autel IM608 - Mark Van, and so on.
- [ ] Check the dot beside it is green. Gray means the tablet is offline.
- [ ] With the tablet in front of you, click Connect.
- [ ] If the tablet asks to start recording or casting, tap Start now and check Don't show again.
- [ ] Confirm you can see and control the screen. The green Zoho bubble on the tablet means the session is live.
- [ ] In the Zoho Assist settings, turn off Session Confirmation so nobody has to tap Accept on future connections.

## Step 8: Driving an Autel remotely

A mouse plugged into your laptop is the most reliable way to control the tablet.

### Swiping

- Click, hold and drag in one quick motion. Start moving the moment you click.
- Pause before moving and Android reads it as a tap or a long-press instead of a swipe.
- This covers scrolling lists, changing home screen pages and dragging menus.

### Trackpad only

- Turn on three-finger drag: System Settings > Accessibility > Pointer Control > Trackpad Options > Dragging style > Three-finger drag.
- Slide three fingers to swipe.

### The Autel bottom bar

Use these instead of swiping where you can.

| Icon | What it does |
| --- | --- |
| Back arrow | Go back |
| House | Autel home screen |
| Car with a face | Android desktop and all apps (Zoho, Chrome, Files) |
| Square | Recent apps |
| Chrome | Browser |
| Status icons and clock, bottom right | Notifications and quick settings |

### Good to know

- To change home screen pages, swipe left or right quickly, or use the car-with-a-face icon to reach all apps directly.
- Notifications live in the bottom-right status area. Autel tablets have no pull-down shade at the top.
- The Zoho Assist phone app works well too, because finger swipes go straight through.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Laptop stuck on "You'll be able to access the remote device shortly" | Check the dot. Gray means the tablet is offline. Open the Customer App on the tablet, recheck Battery (Unrestricted) and Notifications, and wait for green. |
| Tapping a downloaded file does nothing | It's a bundle (.apkm). Install it through APKMirror Installer. |
| An install link sends you to the Play Store | Don't use Zoho's install link. Use the WorkDrive files (Steps 3 and 4). |
| You can see the screen but can't control it | Turn on Accessibility for the Universal Add-on. |
| The deployment link does nothing | Restart the tablet, then open the link again with the Customer App. |
| Someone has to tap Accept on every connection | Turn off Session Confirmation in the Zoho Assist settings. |
| The tablet keeps going offline | Set Battery to Unrestricted and keep the Customer App updated. |
| Swipes act like taps | Swipe in one fast motion with no pause, or use a mouse. Recheck Accessibility for the Universal Add-on. |

## Maintenance

- **Every 3 months:** download the newest Customer App bundle from [APKMirror](https://www.apkmirror.com/apk/zoho-corporation/customer-app-zoho-assist/), replace the file in the WorkDrive folder and put the new version number in the file name. On each tablet, install it over the old one with APKMirror Installer. Enrollment and permissions carry over.
- **After any app update:** check that Accessibility > Zoho Assist Universal Add-on is still On.
- **When a tablet is retired or replaced:** delete it from Unattended Access in the console at https://assist.zoho.com/portal/absoluteadas/app/home, so it doesn't clutter the list or hold a license slot.
- **Security:** only the files in our WorkDrive folder, or fresh from APKMirror ([APKMirror Installer](https://www.apkmirror.com/apk/apkmirror/apkmirror-installer-official/) · [Customer App - Zoho Assist](https://www.apkmirror.com/apk/zoho-corporation/customer-app-zoho-assist/)). Nothing from any other APK site.
