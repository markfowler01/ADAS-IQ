# New Van Runbook

2026-10-04 · Mark Fowler

## Overview

A new van goes from "found it" to "on the road, calibrating" in five to six weeks: two weeks waiting on the shelving and the kits, then a few weeks of actually building the van out. The trick is to start every long-lead order the day the van is found, so the shelving and the tool kits land the week the van does and the build-out starts straight away.

| Track | Lead time | Start it when |
| --- | --- | --- |
| Van: find, finance, pick up | 1–2 weeks | Day 0 |
| Shelving: order | about 2 weeks to arrive | The day the van is found |
| Tool kits (Autel frame, targets, scanner, tablet, laptops) | about 2 weeks from Automotive Equipment Specialists | The day the van is found and financed |
| Wrap | 2 days at the wrap shop | Book on day 0 for the week the van arrives |
| Window tint | 1 day | Same shop or right after the wrap |
| Build-out: shelving in, kits installed, labels, inventory, enroll | a few weeks | The week the shelving and kits land |

The van: Dodge Ram ProMaster 2500, high roof. Same model every time so the shelving and the layout are identical van to van.

## Day 0: the van is found

Do all of these the same day. Every one of them is on the critical path.

- [ ] Finance the van. Get the VIN, the plate (or temp), and the pickup date.
- [ ] Ops → Van map → + New van. Name it the next number, leave the tech unassigned for now, keep "standard kit" ticked. Enter the VIN and plate on the header.
- [ ] Book the wrap for the week the van arrives. Send the wrap shop the locked design (white base, "SAME DAY. DONE RIGHT."). It takes two days.
- [ ] Book the window tint, same shop if they do it, otherwise right after the wrap.
- [ ] Order the shelving. Same layout as the last van. Ask for the delivery date.
- [ ] Order the tool kits from Automotive Equipment Specialists: Autel MA600 frame, the target set, the MS909, the IM608 if this van gets one, the mats and stands. About two weeks; confirm the date.
- [ ] Order the two laptops (one Shop, one Euro) and the tablet if it is not in the kit. Start the Shop Laptop Setup runbook as soon as they arrive.
- [ ] Put every expected date on the van's notes so the Due tab can carry them: shelving, kits, laptops, wrap, tint.

## Week 1: pick up and insure

- [ ] Add the van to the insurance policy before pickup. Put the carrier, policy number, agent phone and expiry on the van header; add the insurance card and the registration to the Glovebox.
- [ ] Pick up the van. Enter the odometer on the header. Log a "Repair" record with the purchase date and mileage so the service clock starts.
- [ ] GPS tracker installed; serial on the van record.
- [ ] Drop the van at the wrap shop on the booked date.

## Week 2: wrap and tint, shelving and kits arrive

- [ ] Wrap (two days), then tint. Pick the van up and take the photo for the van record.
- [ ] Shelving arrives: this starts the build-out. Assemble and install on the same shelf and bin plan as the other vans, so "Shelf 2 · bin C" means the same thing in every van.
- [ ] Tool kits arrive: unbox, check every serial against the packing list, note any missing piece on the order.
- [ ] Laptops: run the Shop Laptop Setup and Euro runbooks. Tablet: run the Autel Tablet Remote Access runbook.

## Build-out (a few weeks): install, label, inventory, enroll

- [ ] Ops → Equipment: every tool on the van's lane with its serial, nickname and its home in the van. The standard kit items that "+ New van" created get their real serials now.
- [ ] Subscriptions: the Autel tablet and the IM608 get their purchase date (one-year term). The shared OEM subscriptions already cover the new Shop laptop; add any per-van one.
- [ ] Print the QR labels for the van (Equipment → 🏷 Print labels, pick the van) and put one on every tool and case.
- [ ] Load the van. Everything in its home.
- [ ] Assign the tech on the van header. Zoho Assist and MDM names on the laptops and tablet (Zoho Assist Console runbook).
- [ ] First weekly van check (✅ Van check): odometer, every tool present. This is the baseline inventory.
- [ ] Insurance card, registration and the wrap and shelving receipts in the Glovebox.

## Done when

- [ ] The van shows on the Van map with the tech, both laptops, the tablet, the gear tiles filled, and every light green or gray (no red, no "+ assign").
- [ ] The first weekly check is saved with nothing missing.
- [ ] The tech has done one job out of it.
