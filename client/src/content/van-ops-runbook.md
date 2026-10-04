# Van Ops Runbook

2026-10-04 · Mark Fowler

## Overview

Every van is run from the Ops page. The Van map shows what is in the van and what needs attention; the rest of this runbook is the weekly rhythm that keeps it true.

| When | Who | What | Where |
| --- | --- | --- | --- |
| Every Monday | The van's tech | Weekly van check | Ops → Van map → ✅ Van check |
| Any time gear moves | Whoever moves it | Transfer the tool | Ops → Van map → tap the gear → ↔ Transfer |
| After any service | Whoever paid | Log the service | Ops → Van map → tap the van tile → 🔧 Log a service |
| When a reminder lands | Mark or Kat | Book the service or renewal | Ops → Due |
| New tech or van swap | Mark | Handover check | Ops → Van map → 🤝 Hand over |

## The weekly van check

Takes five minutes. Do it before the first job on Monday.

- [ ] Open Ops → Van map, pick your van, tap ✅ Van check.
- [ ] Vehicle: tires and pressure, oil and fluids, lights and wipers, body and glass, clean with the gear secured. Tap Issue on anything that is not right.
- [ ] Enter the odometer. This is what drives the oil change and the 30k / 60k / 90k reminders.
- [ ] Go through the gear list. Everything is marked present; tap Missing on anything that is not in the van.
- [ ] Notes: damage, what is running low, anything odd.
- [ ] Save. Missing gear turns its tile red on the map and goes to Due; the check posts to #dispatch.

## Moving a tool between vans

We have one set of some targets per area. When it moves, the app has to know.

- [ ] On the Van map, tap the gear tile the tool is in.
- [ ] Tap ↔ Transfer next to the tool, pick the van it is going to, add why (the job or RO), tap Move.
- [ ] That is it. The tool shows on the other van, the transfer is logged with your name and the time, and #dispatch gets a line.
- [ ] On the Equipment tab you can also drag a card to another van's lane.

## Labels

- [ ] Every tool and case gets a QR label: Ops → Equipment → 🏷 Print labels (one van or all), Avery 5160 sheets.
- [ ] Scan a label with the phone camera and the app opens on that tool.
- [ ] Each tool has a home in the van ("Shelf 2 · bin C") on its record. Put it back there.
- [ ] Tracker tags (Milwaukee TICK / ONE-KEY) go on the expensive items later; the tag id lives on the tool's record so the two systems line up.

## Services, reminders and milestones

- [ ] Oil change every 5,000 miles or 6 months, whichever comes first (Ford severe-duty for a working Transit). Tire rotation 7,500 / 6 months. Brakes 40,000. Transmission fluid and coolant at 60,000.
- [ ] 30k, 60k, 90k, 120k and 150k are milestone services with their own checklist on the van tile. They come due 1,000 miles out and go red once past.
- [ ] Reminders go to Mark's alerts and #dispatch every morning for anything overdue, due inside 14 days, or inside 500 miles, and Ada reads them in the morning briefing.
- [ ] When a service is done, tap the van tile → 🔧 Log a service: type, date, odometer, cost, shop. The next due date is set from it. For a milestone, pick "Log the 30k service" on the milestone line.

## Glovebox

- [ ] Each van's documents live in WorkDrive under Command Center → 01_Ops → Vans → the van. Add them from the van tile → 📄 Glovebox → + Add: insurance card, policy, registration, title, inspection, receipts. A photo from the phone is fine.
- [ ] The insurance carrier, policy number and the agent / claims phone are on the van's header. Tap the phone number to call.
- [ ] Pulled over: open the van tile, tap the insurance card, show the screen.

## Consumables

- [ ] Anything we use up (tape, cleaning, test strips) is an Equipment item with category Consumable, a quantity on hand and a reorder level.
- [ ] When it drops below the level it shows on Due as Low stock. Update the quantity when you restock.

## Handover

- [ ] Ops → Van map → 🤝 Hand over. Pick who gets the van, run the same check (vehicle, odometer, every tool present or missing), sign.
- [ ] The van's tech changes, the check is on the van's record, and #dispatch gets a line. A van never changes hands without a record of what was in it.
