# Zoho Assist Unattended Access on Autel Tablets

2026-10-03 · Mark Fowler

**Department:** Tech
**Applies to:** Autel MaxiSys tablets (MS909, IM608 and other Android-based Autel units)
**Purpose:** Let the office or a senior tech remotely view and control a field tablet through Zoho Assist, with no one needing to accept the connection on the tablet.

## Why this SOP exists

- Autel tablets don't have the Google Play Store, so Zoho's normal install link won't work.
- The Zoho apps are sideloaded from files saved in our WorkDrive folder. They come from APKMirror and are verified as signed by Zoho.
- Don't buy TeamViewer for Autel's built-in Remote Desk. We already pay for Zoho Assist.

## What you need

- The Autel tablet, charged and on Wi-Fi
- Access to the Zoho Assist console (laptop or phone app)
- A mouse for your laptop (recommended)
- About 20 minutes

## Step 1: Clean slate

- [ ] On the tablet: Settings > Apps.
- [ ] Uninstall any existing Zoho Assist apps.
- [ ] Restart the tablet.

## Step 2: Allow app installs

- [ ] Android 7: Settings > Security > Unknown sources > On
- [ ] Android 8+: Settings > Apps > Special access > Install unknown apps > allow the browser and file manager

## Step 3: Download the setup files from WorkDrive

- [ ] On the tablet's browser, open the shared WorkDrive folder: Tech Dept > Autel Setup > Zoho Assist (or scan the QR code posted in the shop).
- [ ] Download all files:
  - 1_APKMirror-Installer.apk
  - 2_Zoho-Customer-1.48.apkm
  - 2b_Zoho-Customer-1.37.2.apk (fallback only)
  - 3_Zoho-Universal-Addon.apk

## Step 4: Install in order

- [ ] Tap 1_APKMirror-Installer.apk > Install.
- [ ] Open APKMirror Installer > Browse files > Downloads > 2_Zoho-Customer-1.48.apkm > Install package > Install. Skip or wait out the ad if one appears.
- [ ] If it fails, tap 2b_Zoho-Customer-1.37.2.apk and install it directly. Update to the newest version later.
- [ ] Tap 3_Zoho-Universal-Addon.apk > Install. This add-on is what allows remote control, not just viewing.

## Step 5: Grant permissions

Accept every Zoho prompt. If one gets skipped, set it manually:

- [ ] Accessibility: Settings > Accessibility > Zoho Assist Universal Add-on > On
- [ ] Device administrator: Activate
- [ ] Display over other apps: On
- [ ] Battery optimization: Allow / Unrestricted (critical, or the tablet goes offline)
- [ ] Notifications: Allow

## Step 6: Enroll for unattended access

- [ ] In the Zoho Assist console: Unattended Access > Deployment > Android and copy the deployment link.
- [ ] Email it to the tablet.
- [ ] On the tablet, open the link with the Customer App.
  - If nothing happens, restart the tablet and open the link again.
  - Or press and hold the link > Open with > Customer App.
- [ ] Tap Yes to enroll.
- [ ] In the Customer App, confirm it says Unattended access is enabled.

## Step 7: Name and test

- [ ] In the console, rename the device so we know whose it is, e.g. "Autel MS909 - Jaden Van".
- [ ] Check that the dot next to it is green (online). Gray means offline.
- [ ] Click Connect with the tablet in front of you for the first test.
- [ ] If the tablet asks to start recording/casting, tap Start now and check Don't show again.
- [ ] Confirm you can see and control the screen. The green Zoho bubble on the tablet means the session is live.
- [ ] In Zoho Assist settings, turn off Session Confirmation so no one has to tap Accept on future connections.

## Step 8: Navigating the Autel remotely

Best setup: use a mouse plugged into your laptop. It's the most reliable way to control the tablet.

### Swiping

- Click, hold and drag in one quick motion. Start moving immediately.
- If you pause before moving, Android reads it as a tap or long-press instead of a swipe.
- Works for scrolling lists, changing home screen pages and dragging menus.

### Trackpad (no mouse)

- Turn on three-finger drag: System Settings > Accessibility > Pointer Control > Trackpad Options > Dragging style > Three-finger drag.
- Slide three fingers to swipe.

### Use the Autel bottom bar instead of swiping

| Icon | What it does |
| --- | --- |
| Back arrow | Go back |
| House | Autel home screen |
| Car with face | Android desktop / all apps (Zoho, Chrome, Files) |
| Square | Recent apps (switch between open apps) |
| Chrome | Browser |
| Status icons / clock (bottom right) | Notifications and quick settings |

### Other tips

- Changing home screen pages: quick swipe left or right, or use the car-with-face icon to reach all apps directly.
- Notifications: click the bottom-right status area. Autel tablets don't use a pull-down shade from the top.
- From your phone: the Zoho Assist app on a phone also works well, since finger swipes go straight through.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Laptop stuck on "You'll be able to access the remote device shortly" | Check the dot. Gray = tablet offline. Open the Customer App on the tablet, recheck Battery Unrestricted and Notifications, wait for green. |
| Tapping a downloaded file does nothing | It's a bundle (.apkm). Install it through APKMirror Installer. |
| Install link sends you to the Play Store | Don't use Zoho's install link. Use the WorkDrive files (Steps 3 and 4). |
| Can see the screen but can't control it | Turn on Accessibility for the Universal Add-on. |
| Deployment link does nothing | Restart the tablet, then open the link again with the Customer App. |
| Someone must tap Accept on every connect | Turn off Session Confirmation in Zoho Assist settings. |
| Device keeps going offline | Battery set to Unrestricted. Keep the Customer App updated. |
| Swipes act like taps | Swipe in one fast motion with no pause, or use a mouse. Recheck the Accessibility toggle for the Universal Add-on. |

## Maintenance

- **Every 3 months:** download the newest Customer App bundle from APKMirror (apkmirror.com/apk/zoho-corporation/customer-app-zoho-assist/), replace the file in the WorkDrive folder, and update the file name with the new version number. On each tablet, install it over the old one with APKMirror Installer. Enrollment and permissions carry over.
- **After any app update:** recheck that Accessibility > Zoho Assist Universal Add-on is still On.
- **When a tablet is retired or replaced:** delete it from Unattended Access in the Zoho console (web version at assist.zoho.com) so it doesn't clutter the list or use a license slot.
- **Security:** only use the files in our WorkDrive folder or from APKMirror. Never download Zoho files from other APK sites.
