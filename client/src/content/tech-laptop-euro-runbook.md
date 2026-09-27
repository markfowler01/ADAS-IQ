# Tech Laptop Euro Setup Runbook

2026-09-27 · Mark Fowler

This runbook covers the laptops that program European makes. It builds on [Shop Laptop Setup Runbook](https://claude.ai/code/artifact/19a0b4c5-290d-41ca-adba-786f16b5a911), which stays the source for the base Windows, Zoho and Endpoint Central setup. Only the differences are written here.

## Overview

A Euro laptop takes about a full day to set up, roughly three times the Ford and GM machine, because each European maker ships its own multi-gigabyte diagnostic suite and each one is fussy about the Windows it runs on. Plan for it to be a separate machine from the Ford and GM laptop. Running ISTA, XENTRY and ODIS beside FJDS and Techline Connect on one laptop is where most of the weird failures come from.

| Same as the main runbook | Different on a Euro laptop |
| --- | --- |
| Purchasing, first boot, admin and Tech accounts, Chrome, Zoho Assist, patching, Endpoint Central, power script, wallpaper, handover | Bigger disk and RAM, one maker's suite per install session, US English region locked, antivirus exclusions, much longer programming sessions, per-maker subscriptions that are often per-VIN or per-day |

The laptops are named Tech Laptop Euro #1, Tech Laptop Euro #2 and so on, entered in Windows as TECH-LAPTOP-EURO-1.

One honest caveat up front. European OEM aftermarket access changes often and some of it varies by state. The portal names, subscription shapes and J2534 support below are what is generally true for a US independent shop as of today. Confirm each maker's current terms on the portal before buying, and write what you find into this document so the next person does not have to.

## Hardware

The standard Latitude 5420 works, but only with the memory and disk upgraded. XENTRY alone is well over 100 GB installed and ISTA's programming data is larger still, so a 256 GB or 512 GB drive fills up in a month.

| Part | Minimum for a Euro laptop | Why |
| --- | --- | --- |
| RAM | 16 GB, 32 GB preferred | ISTA and XENTRY each want 8 GB to themselves and Windows wants the rest |
| Drive | 1 TB NVMe SSD | Two or three OEM suites plus their programming data. Do not go smaller |
| CPU | Intel Core i5 11th gen or newer, as in the 5420 | Fine as is |
| Ports | Two USB-A, or one USB-A plus a powered hub kept with the laptop | J2534 box and a USB drive at the same time. The interface itself must never go through the hub |
| Windows | Windows 11 Pro, 64-bit, US English | Some suites refuse other languages or regions |
| Battery | Healthy, but the laptop stays on mains during every session | See Euro programming rules |

When buying, order the 5420 with 32 GB and 1 TB if the seller offers it. If not, a 1 TB NVMe drive and a 32 GB kit are a 15-minute upgrade with one screwdriver, and doing it before Windows is set up means no cloning. Record the upgraded spec in the asset list.

## Base setup

Follow Steps 1 to 6 of the main runbook exactly: purchasing, before powering on, Windows first boot with the admin account and Chrome, Zoho Assist, patching, Endpoint Central. Then apply the changes below before any OEM software goes on.

**Changes to the base steps**

- [ ] Step 1 Purchasing: order or upgrade to 32 GB RAM and a 1 TB drive per the Hardware section. Do the upgrade before first boot.
- [ ] Step 3 rename: enter the name as TECH-LAPTOP-EURO-1, incrementing per machine. Use the same name in Zoho Assist and Endpoint Central.
- [ ] Step 3 region: during first boot pick United States and US English keyboard and never change it. After setup, in Settings > Time & language > Language & region, confirm Windows display language is English (United States), regional format English (United States). XENTRY and ISTA both misbehave on other locales.
- [ ] Step 5 patching: after Windows Update is clean, pause updates for five weeks under Settings > Windows Update > Pause updates while the OEM suites install. A feature update landing mid-install has broken more than one XENTRY setup. Endpoint Central's Sunday patch window takes over once the laptop is in service.
- [ ] Step 6 Endpoint Central: put the laptop in a separate group called Euro Laptops, not Shop Laptops. Same policies, but a longer patch window (Sunday 20:00 to Monday 06:00) because Euro suites take longer to come back after a reboot, and no silent software job for the OEM suites, they all need a logged-in Tech account.

**Extra one-time items on every Euro laptop, done as admin**

- [ ] Antivirus exclusions. Windows Security > Virus & threat protection > Manage settings > Exclusions. Add the install folders for each suite after it installs, typically `C:\Program Files (x86)\Mercedes-Benz`, `C:\Program Files (x86)\BMW`, `C:\Program Files (x86)\Offboard_Diagnostic_Information_System_Service`, and the D: or `C:\ProgramData` folders they create for data. Real-time scanning of a 100 GB data folder is the top cause of ISTA and XENTRY crawling.
- [ ] Virtual memory. Set the page file to system managed on C: and confirm at least 32 GB free disk at all times. Some suites refuse to launch below that.
- [ ] .NET Framework 3.5. Settings > Apps > Optional features > More Windows features, tick .NET Framework 3.5. Several Euro tools still need it and the installer will not always fetch it.
- [ ] Turn off Windows Fast Startup and hibernate. The power script in the main runbook does this.
- [ ] Create the Tech account exactly as in the main runbook Step 7, as an administrator. Every Euro suite runs elevated.

Then sign in as Tech and continue with Interfaces and the Per-make install notes.

## Interfaces

The CarDAQ-Plus 3 is the interface for Euro work. It is on every maker's approved J2534 list below and handles the DoIP (Ethernet over the OBD port) that newer BMW, Mercedes and JLR models need. The Autel MaxiFlash works for older CAN-only cars but is not on the Mercedes or BMW approved lists, so keep it for Ford and GM.

| Make | Approved J2534 device | Protocol needed on newer cars | Note |
| --- | --- | --- | --- |
| BMW and MINI | CarDAQ-Plus 3, or BMW ICOM Next | DoIP from about 2017 | ICOM Next is the factory tool, faster for programming, roughly the price of a laptop. Start with CarDAQ |
| Mercedes-Benz | CarDAQ-Plus 3 | DoIP from about 2019 | Mercedes publishes a short approved list. Confirm the CarDAQ firmware version they require |
| VW, Audi, Porsche | CarDAQ-Plus 3 | DoIP from about 2020 | ODIS works with generic J2534. Porsche PIWIS does not, see per-make notes |
| Volvo | CarDAQ-Plus 3 | DoIP on SPA platform, 2015 onward | VIDA lists specific approved devices, CarDAQ is on it |
| Jaguar Land Rover | CarDAQ-Plus 3 | DoIP on all current models | Pathfinder requires a DoIP-capable device, older J2534-only boxes will not work |

**Install order on a fresh Euro laptop**

- [ ] Install the Drew Technologies J2534 Toolbox as administrator. It carries the CarDAQ-Plus 3 driver and the firmware updater.
- [ ] Plug the CarDAQ in with USB, let Windows finish, then open the J2534 Toolbox and update the CarDAQ firmware. Every Euro suite checks the firmware version and refuses old ones.
- [ ] Confirm the device appears in Device Manager with no warning and in the J2534 Toolbox as connected.
- [ ] Keep the CarDAQ paired with this laptop. Write its serial on the laptop label and in the asset list. Moving CarDAQs between laptops means redoing the per-suite device selection each time.
- [ ] Never run the CarDAQ through a USB hub. Plug it straight into the laptop, always the same port.

## Per-make install notes

Install one maker's suite per sitting, reboot, test it on a car, then start the next. Every portal login and every subscription receipt goes in the Zoho Vault Shop Laptops folder with the laptop name on it.

| Make | Portal | Software | How access is sold | Approximate size |
| --- | --- | --- | --- | --- |
| BMW and MINI | aos.bmwgroup.com | ISTA, with ISTA/P programming data | Subscription by hour, day or year, plus a one-time diagnostic and programming fee per session on some plans | 150 GB and up with programming data |
| Mercedes-Benz | xentry.mercedes-benz.com and the US aftermarket portal | XENTRY Diagnosis Pass Thru EU or XENTRY PassThru | Yearly software licence plus time-based diagnostic access, plus per-VIN or per-day online SCN coding | 100 GB and up |
| VW and Audi | erwin.vw.com and erwin.audiusa.com | ODIS Service | Time-based access sold by hour, day, week or year, plus GeKo security access applied for separately | 40 GB |
| Porsche | Not available to independents | PIWIS Tester | Dealer only. Sublet Porsche programming | n/a |
| Volvo | tis.volvocars.com | VIDA | Time-based subscription | 30 GB |
| Jaguar Land Rover | topix.jaguar.jlrext.com | Pathfinder, plus SDD for older models | Time-based subscription, day or year | 60 GB |

**BMW and MINI, ISTA**

- [ ] Register the shop on the BMW AOS portal. Approval takes a few days, start it before the laptop arrives.
- [ ] Download the ISTA installer and the programming data from the portal. Install as administrator, to the C: drive, default paths.
- [ ] On first launch select the CarDAQ-Plus 3 as the interface under Settings > VCI Config. If it is not listed, the J2534 Toolbox driver is not installed or the firmware is old.
- [ ] Add the BMW install and data folders to Windows Security exclusions.
- [ ] Programming requires the vehicle at 13.5 volts or higher for up to two hours. Use the 70 amp battery support, not a charger.

**Mercedes-Benz, XENTRY Pass Thru**

- [ ] Register on the Mercedes aftermarket portal and buy the Pass Thru software licence. The licence is tied to a hardware ID generated on this laptop, so generate it on the laptop after the Tech account exists and before requesting the key.
- [ ] Install from the downloaded image as administrator. Expect over an hour and at least one reboot.
- [ ] Start XENTRY once, register the CarDAQ-Plus 3 under the Pass Thru configuration, run the self-diagnosis. It flags any firmware or Windows issue before you are under a car.
- [ ] Online SCN coding after a module replacement needs an active online session, so the shop Wi-Fi must reach the laptop in the bay.
- [ ] Never let Windows Update or a Dell BIOS update run while a XENTRY licence is active. The hardware ID can change and the licence stops working until Mercedes reissues it.

**VW and Audi, ODIS Service**

- [ ] Buy time-based access on erWin for the brand you need, VW and Audi are separate portals and separate charges.
- [ ] Apply for a GeKo account through erWin for security access. This is a separate application with an identity check and takes weeks, so start it early.
- [ ] Download ODIS Service and the post-setup package. Install as administrator. Pick the CarDAQ-Plus 3 as the J2534 device in the diagnostic interface settings.
- [ ] Online functions in ODIS use a VW certificate installed to the Tech account profile. Back up the certificate file after it installs.

**Porsche**

- [ ] PIWIS is dealer-only in the US. Do not buy grey-market PIWIS units, they are locked and the software stops updating. Sublet Porsche programming to the dealer and note it in the job.

**Volvo, VIDA**

- [ ] Buy a VIDA subscription on the Volvo TIS portal. Install as administrator. Select the CarDAQ in the VIDA settings.
- [ ] VIDA is a web app that runs locally, so it needs Chrome set as the default browser and pop-ups allowed for localhost.

**Jaguar Land Rover, Pathfinder**

- [ ] Buy access on the JLR TOPIx portal. Pathfinder downloads and updates itself from there on first run, which takes an hour or more.
- [ ] Pathfinder requires a DoIP-capable interface. The CarDAQ-Plus 3 qualifies. Older CarDAQ models do not.
- [ ] For pre-2014 models install SDD as well, from the same portal.

**After every suite**

- [ ] Live read on a matching vehicle in the bay.
- [ ] Add the install folders to Windows Security exclusions.
- [ ] Create a restore point named after the suite, for example Clean ISTA, before starting the next one. If the next install breaks the machine you roll back one suite, not the whole laptop.
- [ ] Record the subscription expiry date and the login's Vault entry in the asset list.

## Euro programming rules

The three shop rules from the main runbook apply word for word, and go on the wallpaper of every Euro laptop. European modules add three more, because their programming sessions run longer and their voltage limits are tighter.

1. Before you start programming, the vehicle is on a power supply. No exceptions. A bricked module costs thousands of dollars.
2. The laptop is on mains. Never close the lid or press power while a progress bar is moving.
3. Full pre-scan before and post-scan after every programming job. It protects us.
4. Battery support, not a battery charger. Euro programming wants a steady 13.5 to 14.5 volts at up to 70 amps for as long as two hours. A trickle charger sags under load and the session aborts halfway. Use the shop's programming power supply and confirm the voltage on the tool before starting.
5. Nothing else runs on the laptop during a session. No browser tabs, no other OEM suite, no Zoho Assist session from the office. A remote connection mid-flash has killed BMW sessions.
6. Wi-Fi stays connected for the whole job. ISTA, XENTRY online SCN and ODIS online all talk to the maker's servers during programming. If the bay has weak Wi-Fi, run an Ethernet cable or a dedicated hotspot before starting, not after it fails.

The power script from the main runbook covers sleep, screen, lid and USB. On Euro laptops also open Settings > Network & internet > Wi-Fi > the shop network > and set it to a metered connection off and private, so Windows never drops it to save power.

## Troubleshooting

The main runbook's troubleshooting table covers Windows, accounts, power and Endpoint Central. These are the failures that only show up with European suites. Add a row every time one bites.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Suite installs but crawls, minutes to open a screen | Windows Security scanning the data folder in real time | Add the suite's install and data folders to Virus & threat protection exclusions and reboot |
| ISTA or XENTRY cannot see the CarDAQ | J2534 Toolbox driver missing, old CarDAQ firmware, or the device is on a hub | Reinstall the Toolbox, update firmware from it, plug the CarDAQ straight into the laptop |
| XENTRY says licence invalid after it worked yesterday | Hardware ID changed, usually after a BIOS update, a new network adapter, or a Windows feature update | Ask Mercedes to reissue against the new ID. In future suspend updates before touching the BIOS |
| Session aborts at 60 to 80 percent with a voltage error | Battery charger sagging instead of a battery support unit | Use the programming power supply, confirm 13.5 volts or higher on the tool before restarting the session |
| ODIS online function fails with a certificate error | VW certificate missing from the Tech profile, or clock wrong | Check clock and time zone first. Reinstall the certificate from the erWin download |
| Pathfinder refuses to connect | Interface is not DoIP capable, or the wrong interface selected | Confirm CarDAQ-Plus 3, not an older CarDAQ or the Autel. Reselect it in Pathfinder settings |
| Suite complains about language or region | Windows regional format changed from English (United States) | Settings > Time & language > Language & region, set both back, reboot |
| Installer stops asking for .NET 3.5 | Optional feature not enabled | Settings > Apps > Optional features > More Windows features, tick .NET Framework 3.5 |
| Disk full warnings after a few weeks | Programming data caches and downloaded update packages | Clear each suite's download cache from its own settings, never by deleting folders by hand. Confirm the 1 TB drive was fitted |
| BMW session died when the office connected by Zoho Assist | Remote session stole focus and input during a flash | Rule 5. Nobody connects to a Euro laptop while a session runs. Set a Cliq message before connecting |

## Handover and open questions

Handover is the same as the main runbook, with the asset list row carrying more. Record all of this per Euro laptop.

| Field | Example |
| --- | --- |
| PC name | TECH-LAPTOP-EURO-1 |
| Service tag, model, upgraded spec | 32 GB, 1 TB, fitted on the date |
| CarDAQ-Plus 3 serial paired to it | On the laptop label too |
| Suites installed | ISTA, XENTRY Pass Thru, ODIS Service, VIDA, Pathfinder |
| Subscription expiry per suite | One line each, with the Vault entry name |
| Restore points | Clean ISTA, Clean XENTRY, and so on, with dates |
| Assigned to | Bay or tech |

At handover, walk the tech through the six Euro programming rules, show them the battery support unit and where the Ethernet cable lives, and set the Euro wallpaper.

**Open questions to settle before the first Euro laptop is bought**

- [ ] Which makes do we actually program in the first year? Each suite is a separate subscription and a separate day of setup, so start with the two or three that pay for themselves and add the rest later.
- [ ] Is one CarDAQ-Plus 3 per Euro laptop in the budget, or do laptops share one? Sharing works but costs a device reselection every swap.
- [ ] BMW volume: enough to justify an ICOM Next, or stay on CarDAQ?
- [ ] Does the shop have a 70 amp battery support unit for the bay where Euro work happens? If not it goes on the same purchase order as the laptop.
- [ ] Confirm current portal terms and prices for each maker and write them into the Per-make table. The figures there are a starting point, not a quote.
