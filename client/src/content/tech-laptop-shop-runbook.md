# Shop Laptop Setup Runbook

2026-09-27 · Mark Fowler

## Overview

A new Absolute ADAS vehicle programming laptop goes from box to bay in about two hours, most of it waiting on Windows Update and the OEM downloads. Three tools do all the work and none of them costs extra at our size.

| Tool | What it handles | Cost |
| --- | --- | --- |
| Zoho Assist (in Zoho One) | Unattended remote access from the first boot onward, so the rest of setup can be done from your desk | Included, a handful of unattended slots |
| ManageEngine Endpoint Central Cloud (free edition) | Registers the laptop to the company, patch schedule, software install, remote control, optional BitLocker | Free up to 25 laptops |
| Zoho One | Zoho Vault for every password and OEM login, OneAuth for MFA on admin accounts | Already subscribed |

The laptop is a shared shop tool, not a personal computer. Laptops are named Tech Laptop #1, Tech Laptop #2 and so on. One shared Tech login for the technicians, one admin login for setup and repair, no email or browsing beyond the OEM portals. Our interfaces are all J2534 (Autel MaxiFlash and Drew Tech CarDAQ-Plus 3), so the Ford software is FJDS and GM is Techline Connect. The reference machine is a Dell Latitude 5420 on Windows 11 Pro, but the steps apply to any Windows Pro laptop.

## One-time setup

Do these once for the company. Skip this section from the second laptop onward.

- [ ] Sign up for Endpoint Central Cloud free edition at manageengine.com using the company Zoho email, not a personal one.
- [ ] Turn on MFA for the Endpoint Central admin login using Zoho OneAuth. Store the recovery codes in Zoho Vault.
- [ ] Add each person who will manage laptops as a technician with their own Endpoint Central login. Never share the admin login.
- [ ] In Zoho Vault create a shared folder called Shop Laptops. Give the laptop admins access. This holds every admin password, every Tech password, and every OEM portal login (Motorcraft, ACDelco TDS, Autel, Drew Tech).
- [ ] Decide once whether BitLocker is on or off for shop laptops. Off is fine for a laptop that never leaves the building and holds no customer data. On if it goes out mobile or an insurer or OEM agreement asks for encryption. Write the decision here.
- [ ] In Endpoint Central build the policies from the Console policies section below and assign them to a group called Shop Laptops so every new machine picks them up automatically.
- [ ] Download the Windows agent installer from Agent > Computers > Download Agent. Keep a copy on a USB stick labelled Laptop Setup and in a WorkDrive folder.
- [ ] Put the OEM and driver installers on the same USB stick: Autel Maxi PC Suite, Drew Tech J2534 Toolbox, FJDS, Techline Connect, Chrome, Zoho Assist unattended installer, Dell Command Update. Downloading them fresh each time is the slowest part of setup.
- [ ] Keep the Absolute ADAS wallpaper template with the WorkDrive installers. Each laptop gets a copy with its own name and the three programming rules.
- [ ] Create an asset list in Zoho Sheet with the columns from the Handover section, or decide to use the Endpoint Central inventory as the single source of truth.

## Per-laptop checklist

Copy this list into a new page or print it for each laptop. In order, top to bottom.

### Step 1: Purchasing

- [ ] Default source is Amazon. Buy elsewhere if the price or the warranty is better, and record where it came from in the asset list so warranty claims go to the right place.
- [ ] Check the Dell warranty on the service tag at dell.com/support once it arrives. Amazon units sometimes ship with the clock already running.
- [ ] Windows 11 Pro, not Home. Home cannot create a local account cleanly and lacks BitLocker management.

### Step 2: Before powering on

- [ ] Write down the Dell service tag from the sticker on the underside.
- [ ] Generate an admin password in Zoho Vault, save it in the Shop Laptops folder with the service tag as the entry name.
- [ ] Have the Laptop Setup USB stick ready.

### Step 3: Windows first boot, admin account, Chrome

- [ ] Power on, plug in to mains, choose region and keyboard, connect to Wi-Fi.
- [ ] Choose Set up for work or school.
- [ ] Click Sign-in options, then Domain join instead. If the option is missing, press Shift+F10 and run the command below, then continue.

```bat
start ms-cxh:localonly
```

- [ ] Create the local account named admin with the password from Vault. Set the three security questions to random strings and store them in the same Vault entry.
- [ ] Decline OneDrive, Microsoft 365 trial, Game Pass, Copilot. Turn off every diagnostics and advertising toggle.
- [ ] At the desktop go to Settings > System > About > Rename this PC. Our laptops are named Tech Laptop #1, Tech Laptop #2 and so on. Windows names cannot contain spaces or the # sign, so enter it as TECH-LAPTOP-1 and increment the number for each new machine. Use the same name in the Zoho Assist and Endpoint Central consoles. Reboot.
- [ ] Install Chrome and set it as the default browser. Everything after this is easier from Chrome than from Edge, and the OEM portals are tested against it.

### Step 4: Remote access with Zoho Assist

- [ ] In Chrome go to assist.zoho.com > Downloads and pick For Customer (Unattended Access) > Windows. Not the Remote Support client, which does not survive a reboot.
- [ ] Run the installer as admin. The installer is tied to our Zoho account so there is nothing to type.
- [ ] On your own computer open Unattended Access > Devices, confirm the laptop appears, rename it to the PC name, move it into the Shop Laptops group.
- [ ] Reboot the laptop and connect from the console while it sits at the login screen. If that works you can finish the rest of this checklist remotely from your desk.
- [ ] Note that Zoho One allows only a handful of unattended devices. Once Endpoint Central is on the laptop its remote control does the same job with no limit, so Assist is optional from laptop two onward.

### Step 5: Patching

- [ ] Settings > Windows Update > Check for updates. Install, reboot, repeat until nothing is left. Usually two or three rounds.
- [ ] Install Dell Command Update from the USB stick or dell.com/support, run it, apply BIOS and drivers. Reboot.

### Step 6: Register with the company in Endpoint Central

- [ ] Run the Endpoint Central agent installer from the USB stick as administrator. It takes a minute or two with no prompts.
- [ ] In the console confirm the laptop appears under Agent > Computers within a few minutes. Move it into the Shop Laptops group. The policies apply on their own.
- [ ] Fill in the asset fields on the computer record: service tag, bay or owner, purchase date, where it was bought.
- [ ] If BitLocker is on for shop laptops, wait for encryption to finish and confirm the recovery key shows on the computer record before handover. If it is off, skip this.

### Step 7: Tech account and OEM software

- [ ] Open Command Prompt as administrator. Press the Windows key, type cmd, right-click Command Prompt, Run as administrator. The title bar must say Administrator and the path must be C:\Windows\System32, or every command below fails with Access is denied.
- [ ] Create the Tech account as an administrator in one line. Replace PASSWORD with one from Zoho Vault. Keep it 14 characters or fewer, or add /y, otherwise Windows stops to ask a yes or no question and swallows the next paste.

```bat
net user Tech PASSWORD /add /y && net localgroup Administrators Tech /add
```

- [ ] Confirm with net user and net localgroup Administrators. Settings > Accounts will not show the new account until you sign out, so do not wait for it there.
- [ ] Press Windows key + L, sign in as Tech. Everything below is done from the Tech account because Ford and GM keep licence data in the profile that installs them.
- [ ] Power settings are machine-wide, so they carry over from the admin account. Check with powercfg /getactivescheme and a glance at Settings > System > Power & battery. Re-run the one-line script from the Vehicle programming settings section if anything is not Never.
- [ ] Check clock and time zone under Settings > Time & language before any OEM login.
- [ ] Work through the three lists below in order: Zoho Vault and interface drivers, then Ford, then GM.
- [ ] Do a live module read on a Ford and a GM in the bay with each interface. Opening the software is not a test.
- [ ] Create a restore point named Clean OEM install: search Create a restore point, System Protection, enable for C:, Create.

#### Zoho Vault and interface drivers

- [ ] Install the Zoho Vault extension in Chrome on the Tech account. Each technician signs in with their own Zoho login. The shop OEM portal credentials sit in the shared Shop Laptops folder so techs can autofill them without knowing them.
- [ ] Install Autel Maxi PC Suite. It carries the J2534 driver for the Autel MaxiFlash.
- [ ] Install the Drew Technologies J2534 Toolbox, which carries the drivers for the CarDAQ-Plus 3 and CarDAQ-Plus 3 Pro.
- [ ] Plug each interface in once, let Windows finish detecting it, and confirm it shows in Device Manager with no warning.
- [ ] Our interfaces are all J2534, so the Ford software is FJDS, not FDRS. If FDRS got installed, uninstall it.

#### Ford install notes

- [ ] Download from motorcraftservice.com in Chrome, logged in with the shop account from Zoho Vault.
- [ ] FDRS is for Ford VCIs (VCM II, VCM 3, VCMM). FJDS is the same software for third-party J2534 boxes. Install only the one that matches the interface.
- [ ] Run the installer as administrator. When it asks to install the Flight Recorder, press No. It is a logging add-on we do not use and it slows the install.
- [ ] Let it reboot if asked, then run it again. First launch pulls a large update, leave it on mains and do not touch it.
- [ ] Plug the VCI in only after the install finishes so Windows does not grab a generic driver.
- [ ] The FDRS licence is tied to this laptop, not the login. Buy it while logged in on the laptop and write the expiry date in the asset list.

#### GM install notes

- [ ] Check the clock and time zone under Settings > Time & language before anything else. GM login fails on a wrong clock and does not say why.
- [ ] Log into acdelcotds.com in Chrome with the shop TDS account from Zoho Vault.
- [ ] Download Techline Connect, run as administrator. First launch installs SPS2 and GDS2 and is slow. Leave it on mains.
- [ ] When it asks which device to use, pick the J2534 box by name. It remembers the choice per device.
- [ ] Do a live read on a GM in the bay before handover.

### Step 8: Remote control test

- [ ] From the console open Tools > Remote Control and connect to the laptop.
- [ ] Reboot the laptop and connect again while it sits at the login screen. This proves boot-time access works before it matters.

## Vehicle programming settings

An interrupted module flash can brick a control module, so the laptop must never sleep, reboot, or drop the interface on its own. Apply these as admin. Once the Endpoint Central power policy is built, it pushes the first four automatically.

| Setting | Where | Value |
| --- | --- | --- |
| Sleep on mains | Settings > System > Power > Screen and sleep | Never |
| Screen off on mains | Same screen | Never |
| Hibernate | Command prompt as admin, see below | Off |
| USB selective suspend | Control Panel > Power Options > Change plan settings > Advanced > USB settings | Disabled |
| Fast Startup | Control Panel > Power Options > Choose what the power buttons do | Unticked |
| Low battery warning | Power Options > Advanced > Battery | 30 percent |
| Driver updates via Windows Update | Settings > Windows Update > Advanced options > Optional updates | Never auto-install |
| Windows Update active hours | Settings > Windows Update > Advanced options | 6:00 to 22:00 so no restart during shop hours |
| Automatic restart | Handled by the Endpoint Central patch window, see Console policies | Sunday night only |

Paste this as one line in a command prompt opened as administrator. It sets every timeout to never, lid close to do nothing, and turns off hibernate, USB, PCIe, CPU and Wi-Fi power saving. It applies to the current plan, because the Latitude 5420 uses Modern Standby and Windows hides the High performance plan on those machines. A line printing "does not exist" is a setting this model lacks and can be ignored. Save it as power.cmd on the setup USB stick and in the Endpoint Central Custom Script policy.

```bat
powercfg /h off & powercfg /change standby-timeout-ac 0 & powercfg /change standby-timeout-dc 0 & powercfg /change monitor-timeout-ac 0 & powercfg /change monitor-timeout-dc 0 & powercfg /change disk-timeout-ac 0 & powercfg /change disk-timeout-dc 0 & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 & powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 & powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb50f7e6d6 0 & powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb50f7e6d6 0 & powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100 & powercfg /setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 0 & powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0 & powercfg /setactive SCHEME_CURRENT
```

Then two settings the script cannot reach: Settings > System > Power & battery > Power mode set to Best performance, and in Device Manager untick "Allow the computer to turn off this device to save power" on every USB Root Hub and on the Wi-Fi adapter.

Three rules for the techs, on the wallpaper of every laptop and printed on the lid:

1. Before you start programming, the vehicle is on a power supply. No exceptions. A bricked module costs thousands of dollars.
2. The laptop is on mains. Never close the lid or press power while a progress bar is moving.
3. Full pre-scan before and post-scan after every programming job. It protects us if a fault is blamed on the flash later.

## Console policies

Build these four in Endpoint Central once and assign them to the Shop Laptops group. A new laptop gets all of them the moment its agent checks in, which is what makes laptop two faster than laptop one.

| Policy | Where in the console | Settings |
| --- | --- | --- |
| Patch window | Patch Management > Automate Patch Deployment | Windows security and critical patches only, deploy Sunday 22:00 to Monday 04:00, reboot allowed in the window only, never outside it |
| Power settings | Configurations > Windows > Custom Script | The one-line powercfg script from the Vehicle programming settings section, run as system, once per machine |
| Software job | Software Deployment > Install | Chrome, Dell Command Update, Zoho Assist unattended, and any driver or OEM installer that supports silent install. FJDS and Techline Connect stay manual because they need a logged-in Tech account |
| BitLocker (optional, see One-time setup) | Security > BitLocker Management | OS drive only, TPM-only unlock so the machine boots to the login screen without a prompt, recovery key escrowed to the console. Suspend BitLocker before any BIOS update or the laptop will ask for the 48-digit key at boot |

Remote control needs no policy. It is on by default under Tools > Remote Control and runs as the agent service, so it works at the login screen after a reboot.

Once there are more than a handful of laptops, also turn on automatic local admin password rotation under Security. The console then changes each admin password on a schedule and stores it, and the Vault entries become the backup rather than the primary copy.

## Handover and inventory

A laptop is done when its row in the asset list is complete and the invoice is with the bookkeeper. Record these per machine, either in the Zoho Sheet asset list or in the Endpoint Central computer record.

| Field | Example | Where it comes from |
| --- | --- | --- |
| PC name | TECH-LAPTOP-1 | You set it at first boot |
| Service tag | 7 characters, sticker on the underside | Dell |
| Model | Dell Latitude 5420 | Dell |
| Assigned to | Bay 3, or a tech name if one person owns it | You |
| Purchase date and cost | From the invoice | Supplier |
| Admin password | Vault entry name, never the password itself | Zoho Vault |
| BitLocker key confirmed | Yes, with the date | Endpoint Central |
| OEM subscriptions on it | Ford FDRS, GM SPS2, Toyota Techstream | Whatever is installed |
| Interface serial | The J2534 device paired with this laptop | Sticker on the interface |

At handover:

- [ ] Forward the purchase invoice to the bookkeeper so the laptop is recorded as a company asset.
- [ ] Show the tech the Tech login, where the OEM shortcuts are, and the two lid rules.
- [ ] Label the laptop and its interface with the PC name so they stay paired.
- [ ] Tick the laptop off in this runbook and note anything that went differently in the Troubleshooting section below.

Set the Absolute ADAS wallpaper with the laptop's name and the two flash rules on it as the desktop background and lock screen. Save the PNG in a Wallpaper folder under the Tech account's Pictures, right-click it, Set as desktop background. Each laptop gets its own image with its own name.

When a laptop is retired, wipe it from the Endpoint Central console before it leaves the building, then delete its computer record and its Vault entry.

## Scaling

The free tools cover the shop up to 25 laptops. Below that, the only thing that changes with each new machine is how much of the checklist you can skip.

**European makes get their own laptop and their own runbook.** BMW, Mercedes, VW Audi, Volvo and Jaguar Land Rover software is too large and too fussy to share a machine with FJDS and Techline Connect. Steps 1 to 6 of this runbook apply unchanged; everything after that is in Tech Laptop Euro Setup Runbook.

### What gets faster with each laptop

| Laptop | What you still do by hand | What the console does | Time |
| --- | --- | --- | --- |
| First | Everything in this runbook, including building the four policies | Nothing yet | About 4 hours, including the OEM downloads |
| Second to fifth | Windows first boot, patching, agent install, Tech account, OEM tools that need a logged-in user | BitLocker, power settings, patch schedule, silent software | About 2 hours, mostly waiting on downloads |
| Sixth onward | Windows first boot and agent install | Everything else, including admin password rotation | About 90 minutes |

### Thresholds and what to do at each

| When | What changes | Action |
| --- | --- | --- |
| 5 laptops | Managing admin passwords by hand gets error-prone | Turn on local admin password rotation in Endpoint Central. Vault becomes the backup copy |
| 5 laptops | Windows Update rounds at first boot eat most of the setup time | Build a Windows 11 install USB with the Media Creation Tool every quarter so the base image is already current. Or ask Dell to ship with the latest image |
| 10 laptops | Techs forget which shared login goes with which laptop | Consider Zoho Directory device authentication so techs log into any laptop with their Zoho account. Bundled edition caps at 10 devices, Professional is about $7 per user per month above that |
| 10 laptops | Zoho Assist unattended access limit | Already sidestepped by using Endpoint Central remote control. Nothing to do |
| 25 laptops | Endpoint Central free edition cap | Move to the paid edition, priced per endpoint. Or split into two free tenants, which is messy and not recommended |
| Any count | Buying more than two at a time | Open a Dell business account. Dell can factory-register laptops to Windows Autopilot, but that needs Microsoft Entra, so for us the value is volume pricing and a single warranty contact |

### Things that do not scale and should be replaced early

- The USB stick. From about five laptops, put every installer in a WorkDrive folder and in the Endpoint Central software repository so any admin can set up a laptop without hunting for the stick.
- Sticky notes with OEM logins. Every credential in Zoho Vault from day one, with the laptop name in the entry.
- One person knowing the process. This runbook is the process. Anyone with an Endpoint Central technician login and Vault access should be able to follow it cold.

## Troubleshooting

Add a row every time a setup goes sideways. The fix column is what saves the next hour.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Setup screen will not offer a local account | Windows Home, or a newer build that hides the option | Shift+F10, run the ms-cxh command from the checklist. If it is Home, return the unit and buy Pro |
| net user says System error 5, Access is denied | Command prompt is not elevated, even though you are logged in as admin | Close it. Windows key, type cmd, right-click, Run as administrator. Title bar must say Administrator |
| net user asks Do you want to continue (Y/N) and the next command vanishes | Password longer than 14 characters triggers a prompt that eats the next pasted line | Type Y and Enter, or add /y to the command. Use the one-line version from Step 7 |
| Two commands pasted together, The option /ADDNET is unknown | Clipboard dropped the line break | Paste one line at a time, or use the single line joined with && from Step 7 |
| New account not in Settings > Accounts but net user lists it | Settings caches the list | Sign out with Windows key + L. It appears on the login screen |
| powercfg says The power scheme, subgroup or setting specified does not exist | Latitude 5420 uses Modern Standby and hides the High performance plan, and lacks a couple of PCIe and Wi-Fi settings | Use the one-line script from the Vehicle programming settings section, which targets the current plan and skips missing settings. One or two of those messages is normal |
| Laptop never appears in Endpoint Central | Agent installed without admin rights, or shop Wi-Fi blocks outbound | Reinstall as administrator. Check the agent service is running. Try a phone hotspot to rule out the network |
| BitLocker key not in console | Encryption still running, or policy not assigned | Wait for encryption to finish. Confirm the laptop is in the Shop Laptops group. Never hand over without the key visible |
| Ford software cannot see the interface | FDRS installed instead of FJDS, or driver missing | Our boxes are J2534. Uninstall FDRS, install FJDS. Confirm the Autel or CarDAQ driver shows in Device Manager first |
| GM Techline Connect login fails with no clear error | Clock or time zone wrong | Settings > Time & language, sync now, correct the zone, retry |
| OEM tool cannot see the J2534 interface | Wrong driver version, USB selective suspend, or tool needs admin | Install the driver from the USB stick not Windows Update. Confirm selective suspend is off. Tech is already an administrator |
| Interface drops mid-session | Sleep, USB power saving, or a loose USB hub | Recheck the Vehicle programming settings table. Plug the interface directly into the laptop, never through a hub |
| Laptop rebooted during a flash | Windows Update outside the patch window, or Fast Startup | Confirm active hours and the patch window. Turn Fast Startup off. Check Endpoint Central patch history for what restarted it |
| Remote control connects but shows a black screen | Display driver or the laptop is at the BitLocker prompt | Confirm TPM-only unlock so there is no pre-boot prompt. Update the Intel graphics driver via Dell Command Update |
| Admin password does not work | Rotation turned on and Vault entry is stale | Read the current password from the Endpoint Central computer record, not from Vault |
| Windows Update loops for hours at first boot | Old factory image | Build a current install USB per the Scaling section, or leave it running overnight and finish the next day |

When something new breaks, note the laptop name, the date, and what fixed it here before moving on. A row written the same day is worth ten remembered later.
