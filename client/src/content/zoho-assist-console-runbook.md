# Zoho Assist Console Runbook

2026-10-03 · Mark Fowler

## Overview

Zoho Assist (in Zoho One) is our remote access tool for every company device: the shop laptops and the Autel tablets in the vans. This runbook is how the console is organized, so a device is always easy to find and the right people can reach it. The per-device install steps live in the two setup runbooks (Shop Laptop Setup, Autel Tablet Remote Access).

Two ideas run the whole console:

| Idea | What it is for | Rule |
| --- | --- | --- |
| Device groups (folders) | Where a device lives | Grouped by **type**, never by person |
| Teams | Who is allowed to connect | Grouped by **role** |

Devices outlive the people who carry them. A tablet moves to the next hire, a laptop moves to another van. Grouping by type means nothing has to move when that happens; the person is in the device name instead.

## Device groups

Create these under Unattended Access > Devices, and nothing else:

| Group | What goes in it |
| --- | --- |
| Shop Laptops | Every vehicle programming laptop (TECH-LAPTOP-1, TECH-LAPTOP-EURO-1 and so on) |
| Van Tablets | Every Autel tablet (MS909, IM608 and the rest) |
| Office | Desk machines, if and when they are enrolled |

- [ ] Do not create a group per technician or per van. The device name carries that.
- [ ] A new device goes into its group the day it is enrolled (Step 7 of the tablet runbook, Step 4 of the laptop runbook).

## Naming

Model first, then the person or van, so the list sorts by type and still reads who has what.

| Device | Name in Assist |
| --- | --- |
| Shop laptop | TECH-LAPTOP-2 - Jayden |
| Euro laptop | TECH-LAPTOP-EURO-1 - Mark |
| Autel tablet | Autel MS909 - Jayden Van |
| Key programmer tablet | Autel IM608 - Mark Van |

- [ ] Laptops keep the exact Windows PC name as the first part. It must match the Endpoint Central console too.
- [ ] When a device changes hands, rename it the same day. Do not move it.

## Teams

Teams decide who can connect to which group. Set them under Settings > Teams (or Departments, depending on the console version) and give each team access to its groups.

| Team | Members | Can reach |
| --- | --- | --- |
| Office | Mark, Kat | Every group |
| Senior Techs | Techs Mark names | Van Tablets only |

- [ ] Technicians are not members of any team unless they need to remote into other devices. Carrying a tablet does not need Assist access.
- [ ] Only make a per-person group if a technician must reach their own devices and nobody else's. Then it is one group ("Jayden's devices") with a team of one, and it is the exception, not the pattern.

## Session rules

- [ ] Session Confirmation is off for every unattended device, so nobody in the field has to tap Accept.
- [ ] Say something before you connect to a tablet that is in use. A screen moving on its own in the middle of a calibration is a bad surprise.
- [ ] Never leave a session open after you are done. Disconnect from the console.

## License slots

Zoho One includes only a handful of unattended devices. The tablets need them, because Assist is the only remote tool that works on an Autel. The laptops do not, once Endpoint Central is on them: its remote control does the same job with no limit.

- [ ] Tablets get the Assist slots first.
- [ ] From the second laptop onward, use Endpoint Central for remote control and only enroll the laptop in Assist if a slot is free.
- [ ] If a slot is needed and none is free, retire a laptop from Assist before anything else.

## Retiring a device

- [ ] Delete it from Unattended Access in the console at https://assist.zoho.com/portal/absoluteadas/app/home so it frees its slot and stops cluttering the list.
- [ ] Uninstall the Zoho Assist apps on the device if it is being handed on or sold.
- [ ] Update the Ops Hub laptop or tool list so the asset shows where it went.
