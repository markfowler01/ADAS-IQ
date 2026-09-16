// Onboarding course — written from how the app actually runs (Mark
// 2026-09-16: "use the information you have to create each one of these
// modules fully"). Stored in AppConfig `onboarding_course`; Mark + Kat edit
// in Directory → Training. Each module: tracks (core = everyone), a
// recording script (owner-only talking points for the video), the reading
// the new hire sees, and a 5-question quiz. video_url stays blank until
// Mark links one.
export const TRACKS = { tech: 'Technician', apprentice: 'Apprentice technician', ops: 'Billing & dispatch' }
export const DEFAULT_COURSE = { version: 2, pass_pct: 80, modules: [

  { id: 'welcome', tracks: ['core'], title: 'Welcome to Absolute ADAS', minutes: 6, video_url: '',
    script: `- Who I am, why I started this in October 2025, and what we do in one sentence.
- Show the van. "Same day. Done right." is on the side for a reason.
- Who's who: Kat runs dispatch and billing; Jayden is our calibration tech; Joyce keeps the books. Everyone reports to me.
- What a good day looks like: on time, clean photos, clean report, shop never has to chase us.
- How we talk: Cliq #dispatch for the day's traffic, #aajobs for jobs, text me if it's urgent.
- Sign off the way we always do: GET SOME!!!`,
    reading: `Absolute ADAS is a mobile ADAS calibration company based in Washington. After a body shop repairs a car, the driver-assist systems — cameras, radars, sensors — have to be calibrated so the car sees the road the way the factory intended. We drive to the shop, do that work in their bay, prove it with photos and a report, and the shop gets the car back the same day.

The promise is painted on the van: SAME DAY. DONE RIGHT. Every job is judged on two things. Did we show up when we said we would. Can the shop hand our report to the insurer without a single question.

Who's who: Mark Fowler is the founder and owner and runs the technical side. Kat Belmonte is the Operations Manager — dispatch, scheduling, invoicing, quotes, and the customer relationship day to day. Jayden Goshorn is our ADAS Calibration Technician. Joyce Cruz is our Accounting Specialist and keeps the books. Everyone reports to Mark.

How we talk: the app is the system of record. Cliq is the radio — #dispatch for the day's traffic and questions, #aajobs for job updates. If it's urgent and you're on a car, call Mark. Every team message ends the same way: GET SOME!!!`,
    quiz: [
      { id: 'q1', q: 'What do we do?', options: ['Sell ADAS parts', 'Calibrate driver-assist systems at the body shop after a repair', 'Repair collision damage', 'Tow vehicles to the dealer'], correct: 1 },
      { id: 'q2', q: 'Who runs dispatch and billing?', options: ['Mark', 'Joyce', 'Kat', 'The shop'], correct: 2 },
      { id: 'q3', q: 'Our promise is…', options: ['Cheapest in town', 'Same day. Done right.', 'Next-day service', 'Dealer quality'], correct: 1 },
      { id: 'q4', q: 'Where does the day\'s traffic and questions go?', options: ['Email', 'Cliq #dispatch', 'A group text', 'Nowhere, just call'], correct: 1 },
      { id: 'q5', q: 'The two things every job is judged on are…', options: ['Speed and price', 'On time, and a report the insurer accepts without questions', 'Mileage and fuel', 'How many photos'], correct: 1 },
    ] },

  { id: 'jobflow', tracks: ['core'], title: 'How a job flows through the app', minutes: 8, video_url: '',
    script: `- Open the app on the phone. Show the Jobs board columns left to right.
- A request comes in (website, phone, text, Books estimate). Nothing is a job until Kat creates it — request first, always.
- Dispatched: it's on your Live Day with the address, the shop, the calibrations.
- On site: clock in, photo set, calibration, safety inspection, tires, Ready to Invoice.
- Kat takes it from Ready to Invoice: Bill it, both documents, card goes to Completed.
- Show what the card looks like when it's blocked and why the app stops you.`,
    reading: `Every job is a card in the app and it moves left to right: Job Requested → Dispatched → (Pending parts / Need dispatch when something's in the way) → Ready to Invoice → Completed.

Request first, always. A website booking, a phone call, a text, or an estimate that syncs from Zoho Books all land as a Job Requested card. Nothing becomes a real job on the schedule until Kat or Mark creates it. That rule exists because a card that auto-dispatched itself once put a tech at the wrong shop on the wrong day.

Your part as a tech starts when the card is dispatched to you. It shows on your Live Day with the shop, the address, the vehicle, and the calibrations on the estimate. On site: clock in, take the photo set, do the calibration, do the post-collision safety inspection, set the tire pressures, and move the card to Ready to Invoice. If the advisor tells you it's customer pay, or gives you a number, it goes on the card right there.

Kat's part starts at Ready to Invoice. She presses Bill it, which builds both documents from the shop's rules, checks them, and sends. The card moves to Completed.

The app will stop you moving a card to Ready to Invoice with photos or the safety inspection missing. That's not the app being difficult — it's the insurer's question arriving before the insurer asks it.`,
    quiz: [
      { id: 'q1', q: 'Which stage does the tech move the card to when the car is done?', options: ['Completed', 'Ready to Invoice', 'Dispatched', 'Invoiced'], correct: 1 },
      { id: 'q2', q: 'What must be finished before Ready to Invoice?', options: ['Only the calibration', 'Photos + post-collision safety inspection + tire pressures', 'A phone call to the insurer', 'Nothing, Kat checks later'], correct: 1 },
      { id: 'q3', q: 'A website booking comes in. What is it in the app?', options: ['A dispatched job', 'A Job Requested card until Kat or Mark creates the job', 'An invoice', 'A CRM note'], correct: 1 },
      { id: 'q4', q: 'Who moves the card from Ready to Invoice to Completed?', options: ['The tech', 'The shop', 'Kat, by pressing Bill it', 'It moves itself'], correct: 2 },
      { id: 'q5', q: 'The advisor says "this one\'s customer pay, $700." You…', options: ['Tell Kat later', 'Put it on the card at Ready to Invoice', 'Collect cash', 'Ignore it'], correct: 1 },
    ] },

  { id: 'photos', tracks: ['core'], title: 'The photo set — 8 shots, every car', minutes: 10, video_url: '',
    script: `- Walk a car with the phone: the eight shots in order, say why each one exists.
- Show the big orange button and how it moves to the next shot on its own.
- Show the odometer shot and the VIN plate shot being read by the app.
- Bad signal: shoot everything, the phone keeps it, the pill at the bottom shows it uploading.
- Show Ready to Invoice with "photos still uploading — fine."
- Show the job's WorkDrive folder after: this is what the shop and insurer see.`,
    reading: `Eight photos on every job, taken in the app, in this order:
1. Odometer before — dash on, total miles readable.
2. VIN plate — door jamb or dash, straight on. The app reads the VIN and warns if it doesn't match the card.
3. Left front corner — stand at the driver headlight, whole car in the shot.
4. Right front corner.
5. Right rear corner.
6. Left rear corner.
7. Calibration setup — targets, rig, tablet. As many as you want.
8. Odometer after the test drive — must show more than 1 mile over the first shot.

Why: the odometer pair proves the test drive. The four corners prove the car's condition when we touched it, which ends "you scratched my bumper" before it starts. The setup shots prove the calibration was done to spec. The app reads the mileage and the VIN for you.

Bad signal: shoot everything anyway. Every photo is saved on the phone the moment you take it and uploads on its own. You can move the card to Ready to Invoice with photos still uploading — the button says so — and the card carries a "still uploading" note until the last one lands. Kat sees it clear. Never re-shoot because of signal.

Every job has a folder in WorkDrive named by RO number, shop, and vehicle. The photos, the Kinetic report, and the post-scan PDFs all land there. That folder is what the shop forwards to the insurer. Only Mark can override the photo gate, and it shows on the card and in #dispatch when he does.`,
    quiz: [
      { id: 'q1', q: 'How many required shots are in the set?', options: ['4', '6', '8', '12'], correct: 2 },
      { id: 'q2', q: 'Why two odometer photos?', options: ['To bill mileage', 'To prove the test drive of more than 1 mile', 'Insurance requires two', 'To check the VIN'], correct: 1 },
      { id: 'q3', q: 'The signal drops mid-upload. What do you do?', options: ['Re-shoot everything', 'Keep working — photos are saved on the phone and upload on their own', 'Text Kat the photos', 'Skip the photos'], correct: 1 },
      { id: 'q4', q: 'What are the four corner shots for?', options: ['Marketing', 'Proving the car\'s condition when we touched it', 'Measuring the car', 'The insurer never sees them'], correct: 1 },
      { id: 'q5', q: 'Where do the photos, the Kinetic report, and the post-scan end up?', options: ['On your phone', 'Email to Kat', 'The job\'s WorkDrive folder, named by RO, shop, and vehicle', 'Google Drive'], correct: 2 },
    ] },

  { id: 'pcsi', tracks: ['core'], title: 'Post-collision safety inspection and tires', minutes: 8, video_url: '',
    script: `- Seat belts: pull every one, does it retract, does it latch.
- Airbag system: dash light off, no codes in the scan.
- Tire pressures: door-jamb spec, default 36/36 in the app, set all four, tap "All 4 set".
- Windshield camera on the job: check the glass before you calibrate — the app reminds you.
- Show where the checklist lives (photo sheet + Ready to Invoice) and what happens if it's blank.`,
    reading: `After a collision repair we confirm the safety systems before the car goes back to the customer. It's a short checklist in the app, between the VIN shot and the corners, and again at Ready to Invoice:

Seat belts — every position. Pull it out, does it retract, does it latch.
Airbag system — visual check, no warning light, no airbag codes on the scan.
Tire pressures — set all four to the door-jamb spec. The app defaults to 36 front / 36 rear; change it if the sticker says otherwise, then tap "All 4 set". Wrong pressures throw off radar and camera aim.
Windshield — if a windshield camera calibration is on the job, the app tells you to check the glass first: correct part, no distortion, bracket seated. A calibration on the wrong windshield is worthless.

The app won't let a card go to Ready to Invoice until these are confirmed. This isn't paperwork. It's the reason the insurer accepts our invoice line for the inspection, and the reason we can say the car was safe when it left.`,
    quiz: [
      { id: 'q1', q: 'Tire pressures are set to…', options: ['Whatever they were', 'The door-jamb spec (app default 36/36)', '40 psi always', 'Max sidewall'], correct: 1 },
      { id: 'q2', q: 'Which of these is part of the safety inspection?', options: ['Wiper blades', 'Seat belts and airbag system', 'Cabin filter', 'Oil level'], correct: 1 },
      { id: 'q3', q: 'A windshield camera calibration is on the job. Before calibrating you…', options: ['Wash the glass', 'Check it\'s the right windshield, no distortion, bracket seated', 'Skip it', 'Replace the wipers'], correct: 1 },
      { id: 'q4', q: 'Why do tire pressures matter for calibration?', options: ['They don\'t', 'Wrong pressures change the car\'s stance and throw off camera and radar aim', 'Only for the test drive', 'For the invoice'], correct: 1 },
      { id: 'q5', q: 'Where does the checklist live?', options: ['A paper form', 'In the photo sheet and again at Ready to Invoice', 'Kat fills it in', 'The shop\'s system'], correct: 1 },
    ] },

  { id: 'timeclock', tracks: ['core'], title: 'Time clock, pay periods, time off', minutes: 7, video_url: '',
    script: `- Clock in on the app when the day starts, out when it ends. Show it.
- What the app does if you forget: closes you out at 5, tells me, you fix it with an edit request.
- Pay periods 1st–15th and 16th–end. The 15th and last day you review and approve your own time card.
- Overtime past 40 in a Mon–Sun week for W-2. Sick leave 1 hour per 40. Five paid holidays.
- Time Off page for requests. The 8am morning text.`,
    reading: `Clock in when your day starts and out when it ends, in the app, every day. Breaks have their own button.

Forgot to clock out? At 5pm the app closes your shift for you and Mark gets a note. Forgot to clock in on a weekday? The app punches a standard 8-to-5 day with a lunch, flags it to Mark, and asks you to confirm it the next morning. Anything wrong on your card: send an edit request from the Time Clock page with the right times and why. Nothing changes until Mark approves it.

Pay periods are the 1st–15th and the 16th–end of month. On the 15th and the last day of the month the app shows you your time card for the period and asks you to approve it, or fix a shift. Mark gets your approval in Cliq. Payday is the 1st and the 16th.

For W-2 employees: overtime is anything past 40 hours in a Monday–Sunday week, paid at 1.5×. You earn 1 hour of paid sick leave for every 40 hours you work (Washington law). Five paid holidays at 8 hours: New Year's Day, Memorial Day, Independence Day, Labor Day, Christmas Day. Request time off on the Time Off page; Mark approves.

Every morning at 8:00 the team gets a kickoff text with the day. Read it before you roll.`,
    quiz: [
      { id: 'q1', q: 'When are the pay periods?', options: ['Weekly', 'Every two weeks', '1st–15th and 16th–end of month', 'Monthly'], correct: 2 },
      { id: 'q2', q: 'You forgot to clock out yesterday. What now?', options: ['Nothing', 'Send an edit request in the app — Mark approves', 'Text Joyce', 'Clock in twice today'], correct: 1 },
      { id: 'q3', q: 'How is sick leave earned?', options: ['8 hours a month', '1 hour per 40 hours worked', 'Only after a year', 'It is not offered'], correct: 1 },
      { id: 'q4', q: 'On the 15th and the last day of the month you…', options: ['Get paid', 'Review and approve your own time card in the app', 'Take the day off', 'Email your hours'], correct: 1 },
      { id: 'q5', q: 'Overtime for W-2 employees starts after…', options: ['8 hours in a day', '40 hours in a Monday–Sunday week', '45 hours', 'There is no overtime'], correct: 1 },
    ] },

  { id: 'big3', tracks: ['core'], title: 'The Big 3 and what goes on every invoice', minutes: 6, video_url: '',
    script: `- The three lines on every invoice: Cal ID report, post-collision safety inspection, post-scan.
- Per shop, each one is charged or shown as included at $0. That's the shop's rule in the CRM.
- Why they're always on there even at $0: so shops get used to seeing them.
- The fourth: Calibration Snapshot — when a shop does their own post-scan.
- Tech's job: make sure the work behind each line actually happened and is in the photos.`,
    reading: `Every invoice we send carries three lines, no matter the shop: the Calibration Identification Report, the Post-Collision Safety Inspection, and the Post-Scan. For each shop, each of those is either charged or shown as "included" at $0. That's the shop's Big 3 rule, saved on the shop's card in the CRM under Billing.

Why show a line at $0? Mark's rule: so people get used to seeing it. When we start charging for it, it's not a surprise line.

There's a fourth for some shops: the Calibration Snapshot. Some shops do their own post-scan but let us do a snapshot. When Snapshot is charged, Post-Scan comes off that invoice.

If a shop has no rule yet, the first invoice asks Kat which way it goes and saves the answer. Rules only change on purpose, and every change pings #dispatch and Mark.

Your job on site: don't touch prices, but make sure the work behind each line actually happened — the report was generated, the inspection was done and checked off, the post-scan was run — and that the photos back it up.`,
    quiz: [
      { id: 'q1', q: 'The Big 3 are…', options: ['Three techs', 'Cal ID report, post-collision safety inspection, post-scan', 'Three insurers', 'Three vans'], correct: 1 },
      { id: 'q2', q: 'Who sets whether a shop is charged for the Big 3?', options: ['The tech on site', 'The rule saved on the shop in the CRM (Kat/Mark)', 'The insurer', 'The customer'], correct: 1 },
      { id: 'q3', q: 'Why is a line shown at $0 instead of left off?', options: ['A Books limitation', 'So shops get used to seeing it before we charge for it', 'Insurance requires it', 'It isn\'t'], correct: 1 },
      { id: 'q4', q: 'When Calibration Snapshot is charged…', options: ['Nothing else changes', 'Post-Scan comes off that invoice', 'Cal ID report is free', 'The shop pays double'], correct: 1 },
      { id: 'q5', q: 'A shop has no Big 3 rule yet. What happens on their first invoice?', options: ['It fails', 'The app asks Kat and saves her pick as the rule', 'Mark is called', 'The lines are left off'], correct: 1 },
    ] },

  { id: 'customer', tracks: ['core'], title: 'On site: the shop, the advisor, the customer', minutes: 6, video_url: '',
    script: `- Walk in, find the advisor, say who you are, what you're doing, how long.
- Keys and fobs go back to the advisor, never left in the car.
- Customer pay: the advisor says the words or gives a number — it goes on the card at Ready to Invoice, Kat gets it instantly.
- Can't do something the estimate asked for? Say so plainly, let Kat quote the rest.
- You're the company while you're there. Blue shirt, clean van, no drama.`,
    reading: `You are the company while you're on site. Walk in, find the advisor, tell them who you are, what you're going to do, and roughly how long. When you're done, tell them you're done and where the keys are. Keys and fobs go back to the advisor, never left in the car.

Customer pay: if the advisor says "this is customer pay" or tells you a number ($350 or $700 are the usual ones), it goes on the card at Ready to Invoice. Kat and #dispatch get it instantly and the card turns green so nobody bills it as insurance by mistake. Cash jobs price on our cash schedule and never go over the number the customer was told.

If the car needs something we can't do today — a part, a windshield, a dealer-only procedure — say so plainly to the advisor and put it on the card. Kat quotes it. Don't promise a fix you can't deliver.

Insurers ask "why was this calibration needed?" Our answer is the justification on the invoice and the photos in the folder. That's why the report and the photo set matter more than the speed.

No complaints about the shop, the insurer, or the last tech in front of the customer. Ever.`,
    quiz: [
      { id: 'q1', q: 'The advisor says the job is customer pay at $700. You…', options: ['Ignore it — billing is Kat\'s job', 'Put it on the card at Ready to Invoice so Kat bills it right', 'Collect cash', 'Tell the customer to call the office'], correct: 1 },
      { id: 'q2', q: 'The car needs work we can\'t do. You…', options: ['Try anyway', 'Say so plainly and let Kat quote it', 'Say nothing', 'Send them to the dealer'], correct: 1 },
      { id: 'q3', q: 'Where do the keys go when you are done?', options: ['On the seat', 'Back to the advisor', 'In the van', 'On the dash'], correct: 1 },
      { id: 'q4', q: 'An insurer asks why a calibration was needed. The answer is…', options: ['A phone call', 'The justification on the invoice and the photos in the folder', 'A guess', 'The shop\'s problem'], correct: 1 },
      { id: 'q5', q: 'Cash jobs…', options: ['Bill whatever the estimate says', 'Never go over the number the customer was told', 'Are free', 'Skip the photos'], correct: 1 },
    ] },

  { id: 'safety', tracks: ['tech', 'apprentice'], title: 'Safety, the van, and the shop floor', minutes: 6, video_url: '',
    script: `- Wheel chocks, level ground for the targets, nothing where a lift or a tech can hit it.
- The van: locked when you're not at it, tools counted at the end of the day, targets back in their slots.
- If something feels unsafe, stop and call me. Nobody gets in trouble for that.
- Driving: it's a company van with our name on it. Drive like it.`,
    reading: `Chocks on. Targets and the rig set on level ground with room around them. Nothing left on the shop floor where a lift, a cart, or another tech can hit it. Cables and the tablet out of walkways.

The van is locked when you're not at it. Tools get counted at the end of the day; targets go back in their slots so the next morning starts clean. Report anything broken or missing the same day, not the next time you need it.

Driving: the van has our name on it. How you drive is the company's reputation at every light.

If something feels unsafe — a lift, a car that won't hold still, a shop asking you to do something you shouldn't — stop and call Mark. Nobody has ever been in trouble for stopping.`,
    quiz: [
      { id: 'q1', q: 'Where do the keys go when you are done?', options: ['On the seat', 'Back to the advisor', 'In the van', 'On the dash'], correct: 1 },
      { id: 'q2', q: 'Something feels unsafe. You…', options: ['Push through', 'Stop and call Mark', 'Ask the shop to sign a waiver', 'Finish, then report'], correct: 1 },
      { id: 'q3', q: 'Targets and the rig are set up…', options: ['Wherever there is room', 'On level ground with room around them', 'On the lift', 'Outside'], correct: 1 },
      { id: 'q4', q: 'A tool is missing from the van. You…', options: ['Wait until you need it', 'Report it the same day', 'Buy one', 'Borrow from the shop'], correct: 1 },
      { id: 'q5', q: 'The van when you\'re inside the shop is…', options: ['Running', 'Unlocked for speed', 'Locked', 'Left with the shop'], correct: 2 },
    ] },

  { id: 'salesstops', tracks: ['tech', 'apprentice'], title: 'Sales stops between jobs', minutes: 5, video_url: '',
    script: `- The 🚐 Sales stop button on Live Day. Show it: nearest shops, pick one, walk in.
- What to say in 30 seconds. Leave a card, get a card, snap it in the app.
- The three outcome buttons. Confetti.
- Money rule: no bonus per stop; a new customer pays you 1% of their invoices for the first 30 days.
- Weekly goal: 5 stops.`,
    reading: `Between jobs, stop at body shops you're driving past. On Live Day there's a 🚐 Sales stop button: it shows the shops nearest you from the CRM, you pick one, walk in, and ask for the estimator or the manager. Thirty seconds: who we are, same-day mobile calibration, here's my card, who handles ADAS here?

If they hand you a business card, snap it in the app — it reads the name and phone and puts the person on the shop. Pick the outcome (talked to someone, left a card, come back later) and add a line of notes. The CRM updates, #aajobs hears about it, and Kat follows up.

Money: stops themselves don't pay a bonus. A shop that becomes a new customer pays you 1% of their invoices for the first 30 days, tracked automatically from their first invoice. The weekly goal is five stops per tech, and the scoreboard on Live Day shows where you are.`,
    quiz: [
      { id: 'q1', q: 'Where is the Sales stop button?', options: ['The CRM page', 'Live Day', 'Books', 'The website'], correct: 1 },
      { id: 'q2', q: 'You get a business card. You…', options: ['Keep it in the van', 'Snap it in the app — it puts the person on the shop', 'Text it to Mark', 'Throw it away'], correct: 1 },
      { id: 'q3', q: 'What does a sales stop pay?', options: ['$20 each', 'Nothing per stop; a new customer pays 1% of their first 30 days of invoices', '5% forever', 'A gift card'], correct: 1 },
      { id: 'q4', q: 'Weekly stop goal per tech?', options: ['1', '5', '20', 'None'], correct: 1 },
      { id: 'q5', q: 'Who follows up after your stop?', options: ['Nobody', 'You, every day', 'Kat, from the CRM', 'The shop calls us'], correct: 2 },
    ] },

  { id: 'apprentice', tracks: ['apprentice'], title: 'How your apprenticeship works', minutes: 5, video_url: '',
    script: `- You ride with a tech until you're signed off to run alone.
- The skills ladder on your profile: each rung is a calibration type, done a set number of times under supervision.
- The tech you rode with signs the rung off in the app — you can't sign your own.
- Take the photo set yourself from day one. Ask on every car.
- When every rung is signed off, I promote you. Title changes, pay changes, you get a van.`,
    reading: `You ride with a technician until you're signed off to run jobs alone. Your profile in the Directory has a skills ladder: each rung is a type of calibration or task — the full photo set and safety inspection with no misses, front camera static, front radar, blind spot radar, dynamic drive calibrations, 360 camera, pre/post scans, and full solo days with remote support. Each rung needs a set number of supervised reps.

The technician you rode with signs each rep off in the app, the same day, with the car noted. You can't sign your own. Mark can undo a sign-off if it was wrong.

From day one, you take the photo set yourself. Ask questions on every car — the techs expect it. Watch the setup: target distance, ride height, level, the order the tool wants things done. Most calibration failures are setup, not the tool.

When the last rung fills, Mark gets a note and promotes you. Your title becomes ADAS Calibration Technician, your track changes, and you get your own van and route.`,
    quiz: [
      { id: 'q1', q: 'Who signs off a rung on your ladder?', options: ['You', 'The technician or Mark who supervised it', 'The shop', 'Kat'], correct: 1 },
      { id: 'q2', q: 'When do you start taking the photo set yourself?', options: ['After promotion', 'Day one', 'After a month', 'Never — the tech does it'], correct: 1 },
      { id: 'q3', q: 'Most calibration failures come from…', options: ['The tool', 'Setup — distance, ride height, level, order', 'The weather', 'The car'], correct: 1 },
      { id: 'q4', q: 'What happens when the last rung is signed off?', options: ['Nothing', 'Mark is notified and promotes you to technician', 'You start over', 'You get a raise automatically'], correct: 1 },
      { id: 'q5', q: 'Where is your ladder?', options: ['A spreadsheet', 'On your profile in the Directory', 'In Books', 'Mark\'s notebook'], correct: 1 },
    ] },

  { id: 'ops_books', tracks: ['ops'], title: 'Invoicing: Books, Bill it, and the two documents', minutes: 10, video_url: '',
    script: `- Open a Ready to Invoice card. Press Bill it. Show the two columns.
- Left: the insurance invoice — the Books estimate at list price the shop forwards to the insurer.
- Right: the cost invoice — same lines with the shop's discount, the shop pays that, the spread is their margin.
- What gets discounted and what doesn't. Body shop default 25%.
- The Big 4 picker at the top. Send. The card goes to Completed.
- Books quote status is our tracker: Draft, Sent, Invoiced.`,
    reading: `Every calibration becomes two documents in Zoho Books. The insurance invoice is the Books estimate at list price — the shop forwards it to the insurer. The cost invoice is the same lines with the shop's discount applied — the shop pays that, and the spread between the two is their margin. Both go to the shop's billing email.

Bill it, on the Ready to Invoice card, builds both from the shop's rules and shows them side by side. Check: right shop, RO number, vehicle, VIN, the Big 4 lines correct, and any extra items or customer-pay number the tech added on the card. Edit a line on the left and the right follows. Then send. Bill it refuses to run twice on the same job, so a manual invoice and the button can coexist.

Discount rules: body shops default 25% (Gerber Burlington is 30%), auto repair and retail 0%, editable per shop on the CRM Billing tab. Labor and calibrations get the discount. Parts do not. The Calibration Identification Report does not. PCSI and Post-Scan do, except the State Farm post-scan item.

Books quote status is Mark's tracker: Draft means the job was created, Sent means the insurance invoice was emailed, Invoiced means the cost invoice went out.

Rivian jobs bill Rivian's own procedure names — the RIV items in Books. Never change a calibration price; pricing lives in Books and only Mark changes it. If a price looks wrong, stop and ask.`,
    quiz: [
      { id: 'q1', q: 'Who changes calibration prices?', options: ['Whoever is invoicing', 'Mark only', 'The tech', 'The insurer'], correct: 1 },
      { id: 'q2', q: 'What does Bill it build?', options: ['Only a receipt', 'The insurance invoice and the discounted cost invoice for the shop', 'A quote for the customer', 'A CRM note'], correct: 1 },
      { id: 'q3', q: 'Which of these is NOT discounted on the cost invoice?', options: ['Labor', 'A calibration', 'Parts and the Calibration Identification Report', 'PCSI'], correct: 2 },
      { id: 'q4', q: 'Default discount for a body shop?', options: ['0%', '10%', '25%', '50%'], correct: 2 },
      { id: 'q5', q: 'Books quote status "Invoiced" means…', options: ['The job was created', 'The insurance invoice was emailed', 'The cost invoice was sent', 'The insurer paid'], correct: 2 },
    ] },

  { id: 'ops_big3', tracks: ['ops'], title: 'Big 3 rules, DRPs, and new customers', minutes: 8, video_url: '',
    script: `- Open a shop in the CRM, Billing tab. Big 3 picker, DRP chips, discount, Books link.
- "Suggest from invoice history" — the app reads their last 5 invoices.
- Saving a rule pings #dispatch and me. Changing it is deliberate.
- New Customer form: shop, people with roles, DRPs, Big 3 rule, and the Books customer gets created or linked by exact name. Never make a duplicate in Books.`,
    reading: `Each shop's Big 3 rule lives on the shop's card in the CRM under Billing: Cal ID report, post-collision safety inspection, post-scan, each Charge or Included, plus the Calibration Snapshot on or off. The invoice preview applies it for you. If a shop has no rule, the first invoice asks you and saves your pick as the rule. Saving or changing a rule pings #dispatch and Mark, so change it on purpose, not to fix one invoice.

"Suggest from invoice history" on the Billing tab reads the shop's last five Books invoices and proposes the rule with the evidence. Use it when you're not sure.

DRPs — which insurers' direct-repair programs a shop is on — are chips on the same tab. They tell you which insurer's pricing you'll be dealing with most at that shop.

New customers: use the ➕ New Customer form in the CRM. Shop name (Google helps), address, phone, email, the people with their roles (owner, manager, estimators), DRPs, the discount, and the Big 3 rule in one go. Saving it creates the Zoho Books customer, or links to the existing one by exact name. Never create a Books customer by hand if one might exist — we once ended up with 489 duplicate L-M Body Shop customers.`,
    quiz: [
      { id: 'q1', q: 'A shop has no Big 3 rule yet. What happens on their first invoice?', options: ['It fails', 'The app asks you and saves your pick as the rule', 'Mark is called', 'The lines are left off'], correct: 1 },
      { id: 'q2', q: 'Where is a shop\'s Big 3 rule?', options: ['In Books', 'On the shop\'s CRM card, Billing tab', 'In a spreadsheet', 'On the invoice only'], correct: 1 },
      { id: 'q3', q: 'What does "Suggest from invoice history" do?', options: ['Emails the shop', 'Reads the shop\'s last 5 Books invoices and proposes the rule', 'Deletes old invoices', 'Nothing'], correct: 1 },
      { id: 'q4', q: 'Adding a new shop, the Books customer…', options: ['Is created by hand in Books first', 'Is created or linked by exact name from the New Customer form', 'Isn\'t needed', 'Is created by the tech'], correct: 1 },
      { id: 'q5', q: 'Changing a Big 3 rule…', options: ['Is silent', 'Pings #dispatch and Mark — do it on purpose', 'Needs the insurer\'s OK', 'Only Mark can do it'], correct: 1 },
    ] },

  { id: 'ops_dispatch', tracks: ['ops'], title: 'Dispatch, scheduling, and the morning', minutes: 8, video_url: '',
    script: `- Where requests come from: website form, phone, text, email, Books estimate sync. All land as Job Requested.
- Confirm shop, vehicle, RO, calibrations. Create Job. Dispatch to a tech and a day.
- The confirm toggle texts the shop.
- Live Day and the Map: who's where.
- #dispatch: photo gate nudges, "photos still uploading", customer-pay relays. Read it.
- 8:00 kickoff text goes out on its own. Late tech? Shop hears from you first.`,
    reading: `Requests arrive from the website booking form, phone, text, email, and estimates that sync from Zoho Books. Every one lands as a Job Requested card. Nothing auto-dispatches. You confirm the shop, vehicle, RO number, and the calibrations, create the job, and dispatch it to a tech and a day. That's the request-first law.

Confirm every booking back to the shop. The "Shop confirmed" toggle on the scheduler texts them the day and window automatically when the booking came from the website.

Live Day shows each tech's route and where they are on it. The Map shows everyone. If a tech is running late, the shop hears it from you before they ask.

#dispatch is your radio. The app posts there when a tech hits the photo gate, when a card goes to Ready to Invoice with photos still uploading (hold the invoice until the "all photos in" line), when a tech relays a customer-pay number, and when a Big 3 rule changes. Read it as it comes.

At 8:00 every morning the team gets the kickoff text on its own. Your job is that the board it describes is right by then.`,
    quiz: [
      { id: 'q1', q: 'A new request lands. First thing you check?', options: ['The tech\'s mood', 'Shop, vehicle, RO number and the calibrations', 'The weather', 'The invoice total'], correct: 1 },
      { id: 'q2', q: 'A tech is running late. Who tells the shop?', options: ['Nobody', 'The tech when he arrives', 'You, before the shop asks', 'Mark'], correct: 2 },
      { id: 'q3', q: 'What auto-dispatches a request?', options: ['The website form', 'Books sync', 'Nothing — a person creates the job', 'The morning text'], correct: 2 },
      { id: 'q4', q: '#dispatch says a card went to Ready to Invoice with photos still uploading. You…', options: ['Invoice it now', 'Hold the invoice until the "all photos in" line', 'Delete the card', 'Call the tech'], correct: 1 },
      { id: 'q5', q: 'The "Shop confirmed" toggle…', options: ['Emails Mark', 'Texts the shop the day and window for website bookings', 'Does nothing', 'Closes the job'], correct: 1 },
    ] },

  { id: 'ops_cash', tracks: ['ops'], title: 'Customer pay, insurers, and price lists', minutes: 8, video_url: '',
    script: `- Cash jobs: the 💵 Swap to Cash button on the upload review. When the report has no insurer, it's already pressed.
- The cash schedule and the $700 cap. Never above the number the customer was told.
- The card tells you: green frame, $350 or $700 told.
- Insurer families: Allstate family, Liberty Mutual = Allstate pricing, State Farm, Am Fam. The pill on the card.
- Unknown insurer: the app asks once, you pick, it remembers.
- Pricing disputes go to Mark.`,
    reading: `Customer-pay jobs price on our cash schedule (the CP items in Books: $350 per calibration, SAS/SWS $100, Subaru EyeSight $550, dynamic $200) and the total never goes over the cap — $700, or the number the customer was told if the tech put one on the card. On the upload review, the 💵 Swap to Cash button switches a job to cash; it's already pressed when the Kinetic report has no insurer. A cash card is framed green and shows the number told.

Insurers don't all pay the same list. Allstate and its companies (National General, US General, Integon) bill on the Allstate schedule. Liberty Mutual and its companies (Ohio Security, Safeco, Ohio Casualty, Peerless) also bill on the Allstate schedule. State Farm has its own. American Family has its own. Everyone else is standard. The card shows a pill — "ALLSTATE PRICING", "LIBERTY MUTUAL · ALLSTATE PRICING", "STATE FARM PRICING" — and invoicing pulls from the right items on its own. The table lives on the Item Mapping page.

A job comes in with an insurer nobody has seen? The review asks you once which list they use and remembers.

Insurers ask why a calibration was needed: the answer is the justification on the invoice and the photos in the job folder. Pull them, don't guess. Any dispute about pricing goes to Mark.`,
    quiz: [
      { id: 'q1', q: 'A cash customer was told $700. The invoice comes to $850. You…', options: ['Bill $850', 'Bill $700 — never above the quoted number', 'Split the difference', 'Ask the shop'], correct: 1 },
      { id: 'q2', q: 'An insurer asks why a calibration was needed. You…', options: ['Guess', 'Pull the report and photos — the justification is there', 'Refund it', 'Ignore it'], correct: 1 },
      { id: 'q3', q: 'Ohio Security Insurance bills on…', options: ['Standard pricing', 'The Allstate schedule (Liberty Mutual family)', 'State Farm pricing', 'Cash pricing'], correct: 1 },
      { id: 'q4', q: 'The Kinetic report has no insurer. The upload review…', options: ['Fails', 'Has Swap to Cash already pressed', 'Bills standard', 'Asks Mark'], correct: 1 },
      { id: 'q5', q: 'A brand-new insurer shows up. The app…', options: ['Bills standard forever', 'Asks you once which list they use and remembers', 'Blocks the job', 'Emails the insurer'], correct: 1 },
    ] },

  { id: 'ops_crm', tracks: ['ops'], title: 'The CRM: pipeline, zones, follow-ups', minutes: 7, video_url: '',
    script: `- The pipeline columns in Mark's words: Not contacted → Contacted → Shown interest → High value offer / free demo → Current customer → Own ADAS guy (backup / not interested).
- Zones Bellingham to Olympia, each with an owner and a route day. In-play cap of 10 per person.
- Every card: next action + date. The Monday list to Mark and Jayden.
- Competitor tags on the "own ADAS guy" shops.
- Repair customers are separate from shops. Text-as-Mark is Mark's only.`,
    reading: `Every body shop we know about is a card in the CRM, in a zone and a stage. Stages, in Mark's words: Not contacted → Contacted → Shown interest → High value offer / free demo → Current customer, plus "Own ADAS guy, we're their backup" and "Own ADAS guy, not interested" with a 90-day check-back. The counter at the top says how many shops we do business with out of everyone we know.

Zones run Bellingham to Olympia along I-5, each with an owner (Mark or Jayden) and a route day. Each owner keeps at most ten shops "in play" (contacted through offer) so follow-ups actually happen. Every card in play has a next action and a date; the Monday list goes to Mark and Jayden with who's overdue and who's gone quiet.

After any call or stop, log it on the card and set the next action. Shops with their own ADAS guy get a competitor tag so we know who we're up against. Big 3 rules, discount, and DRPs live on the shop's Billing tab.

Repair customers — people whose cars we service directly — are kept separate from shops; toggle at the top of the CRM. Texting a shop from Mark's personal number is Mark's button only.`,
    quiz: [
      { id: 'q1', q: 'After a call with a shop you…', options: ['Remember it', 'Log it on the card and set the next action', 'Text Mark', 'Nothing'], correct: 1 },
      { id: 'q2', q: 'How many shops can one owner have in play?', options: ['Unlimited', '10', '3', '50'], correct: 1 },
      { id: 'q3', q: 'A shop uses a competitor and isn\'t interested. Its stage is…', options: ['Lost', '"Own ADAS guy, not interested" with a 90-day check-back', 'Deleted', 'Current customer'], correct: 1 },
      { id: 'q4', q: 'Where are a shop\'s discount, DRPs, and Big 3 rule?', options: ['Books', 'The shop\'s Billing tab in the CRM', 'A spreadsheet', 'The invoice'], correct: 1 },
      { id: 'q5', q: 'Repair customers (people, not shops) are…', options: ['Mixed in with shops', 'Kept separate — toggle at the top of the CRM', 'Not tracked', 'In Books only'], correct: 1 },
    ] },
] }
