# New Van Runbook

2026-10-04 · Mark Fowler

## Overview

A new van goes from "found it" to "on the road, calibrating" in about three weeks, and almost all of that is waiting on lead times. The trick is to start every long-lead order the day the van is found, so the wrap, the shelving and the tool kits all land in the same week the van does.

| Track | Lead time | Start it when |
| --- | --- | --- |
| Van: find, finance, pick up | 1–2 weeks | Day 0 |
| Wrap | about 2 weeks at the wrap shop | The day the van is found |
| Shelving: order, assemble, install | about 2 weeks to arrive | The day the van is found |
| Tool kits (Autel frame, targets, scanner, tablet, laptops) | about 3 weeks from Automotive Equipment Specialists | The day the van is found and financed |
| Setup: install, label, inventory, enroll | 2–3 days | The week everything lands |

The van: Dodge Ram ProMaster 2500, high roof. Same model every time so the shelving and the layout are identical van to van.

## Day 0: the van is found

Do all of these the same day. Every one of them is on the critical path.

- [ ] Finance the van. Get the VIN, the plate (or temp), and the pickup date.
- [ ] Ops → Van map → + New van. Name it the next number, leave the tech unassigned for now, keep "standard kit" ticked. Enter the VIN and plate on the header.
- [ ] Book the wrap. Send the wrap shop the locked design (white base, "SAME DAY. DONE RIGHT.") and the pickup date. Ask for their install date.
- [ ] Order the shelving. Same layout as the last van. Ask for the delivery date.
- [ ] Order the tool kits from Automotive Equipment Specialists: Autel MA600 frame, the target set, the MS909, the IM608 if this van gets one, the mats and stands. About three weeks; confirm the date.
- [ ] Order the two laptops (one Shop, one Euro) and the tablet if it is not in the kit. Start the Shop Laptop Setup runbook as soon as they arrive.
- [ ] Put every expected date on the van's notes so the Due tab can carry them: wrap, shelving, kits, laptops.

## Week 1: pick up and insure

- [ ] Add the van to the insurance policy before pickup. Put the carrier, policy number, agent phone and expiry on the van header; add the insurance card and the registration to the Glovebox.
- [ ] Pick up the van. Enter the odometer on the header. Log a "Repair" record with the purchase date and mileage so the service clock starts.
- [ ] GPS tracker installed; serial on the van record.
- [ ] Drop the van at the wrap shop on the booked date.

## Week 2–3: wrap, shelving, kits arrive

- [ ] Pick the van up from the wrap. Photo for the van record.
- [ ] Shelving arrives: assemble and install. Same shelf and bin plan as the other vans, so "Shelf 2 · bin C" means the same thing in every van.
- [ ] Tool kits arrive: unbox, check every serial against the packing list, note any missing piece on the order.
- [ ] Laptops: run the Shop Laptop Setup and Euro runbooks. Tablet: run the Autel Tablet Remote Access runbook.

## Setup week: install, label, inventory, enroll

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
