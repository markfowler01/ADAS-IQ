// Default onboarding course (Mark 2026-09-16: "onboarding videos, onboarding
// workflow with some training and Q&A… I want this to be proper"). Stored in
// AppConfig `onboarding_course`; Mark + Kat edit it in Directory → Training.
// video_url is blank until Mark records/links one (YouTube, Loom, WorkDrive).
// tracks: 'core' = everyone (Mark: "everybody goes through the technician
// training so they know what they do"), then 'tech', 'apprentice', 'ops'.
export const TRACKS = { tech: 'Technician', apprentice: 'Apprentice technician', ops: 'Billing & dispatch' }
export const DEFAULT_COURSE = { version: 1, pass_pct: 80, modules: [
  { id: 'welcome', tracks: ['core'], title: 'Welcome to Absolute ADAS', minutes: 5, video_url: '', reading: `Absolute ADAS is a mobile ADAS calibration company. We go to the body shop, calibrate the car's driver-assist systems after a repair, prove it with photos and reports, and the shop gets the car back the same day.

Our promise is on the van: SAME DAY. DONE RIGHT. Every job is judged on two things — did we show up when we said we would, and can the shop hand the insurer a clean report without questions.

You report to Mark. Kat runs dispatch and billing. Joyce keeps the books. GET SOME!!!`, quiz: [
    { id: 'q1', q: 'What do we do?', options: ['Sell ADAS parts', 'Calibrate driver-assist systems at the body shop after a repair', 'Repair collision damage', 'Tow vehicles to the dealer'], correct: 1 },
    { id: 'q2', q: 'Who runs dispatch and billing?', options: ['Mark', 'Joyce', 'Kat', 'The shop'], correct: 2 },
    { id: 'q3', q: 'Our promise is…', options: ['Cheapest in town', 'Same day. Done right.', 'Next-day service', 'Dealer quality'], correct: 1 },
  ] },
  { id: 'jobflow', tracks: ['core'], title: 'How a job flows through the app', minutes: 8, video_url: '', reading: `Every job lives on a card in the app. It moves: Job Requested → Dispatched → (Pending parts / Need dispatch) → Ready to Invoice → Completed.

Your part: open the card when you arrive, clock in, take the photo set, do the calibration, do the post-collision safety inspection, set tire pressures, and move the card to Ready to Invoice. Kat takes it from there.

Never move a card to Ready to Invoice with photos or the safety inspection missing — the app will stop you, and so will Mark.`, quiz: [
    { id: 'q1', q: 'Which stage does the tech move the card to when the car is done?', options: ['Completed', 'Ready to Invoice', 'Dispatched', 'Invoiced'], correct: 1 },
    { id: 'q2', q: 'What must be finished before Ready to Invoice?', options: ['Only the calibration', 'Photos + post-collision safety inspection + tire pressures', 'A phone call to the insurer', 'Nothing, Kat checks later'], correct: 1 },
  ] },
  { id: 'photos', tracks: ['core'], title: 'The photo set (8 shots, every car)', minutes: 10, video_url: '', reading: `Eight photos on every job, in the app, in order: 1) odometer before, 2) VIN plate, 3) left front corner, 4) right front corner, 5) right rear corner, 6) left rear corner, 7) calibration setup (as many as you like), 8) odometer after the test drive.

The odometer shots prove the test drive (more than 1 mile). The corners prove the car's condition when we touched it. The setup photos prove the calibration was done to spec. The app reads the VIN and mileage for you.

Photos are saved on your phone first and upload on their own — if the signal is bad, keep working.`, quiz: [
    { id: 'q1', q: 'How many required shots are in the set?', options: ['4', '6', '8', '12'], correct: 2 },
    { id: 'q2', q: 'Why two odometer photos?', options: ['To bill mileage', 'To prove the test drive of more than 1 mile', 'Insurance requires it', 'To check the VIN'], correct: 1 },
    { id: 'q3', q: 'The signal drops mid-upload. What do you do?', options: ['Re-shoot everything', 'Keep working — photos are saved on the phone and upload on their own', 'Text Kat the photos', 'Skip the photos'], correct: 1 },
  ] },
  { id: 'pcsi', tracks: ['core'], title: 'Post-collision safety inspection + tires', minutes: 8, video_url: '', reading: `After a collision repair we confirm the safety systems: seat belts (retract and latch), airbag system (no lights, no codes), and tire pressures set to the door-jamb spec (commonly 36/36). It's a checklist on the Ready to Invoice screen.

It's not paperwork. It's the reason the shop's insurer accepts our invoice and the reason the car is safe to give back.`, quiz: [
    { id: 'q1', q: 'Tire pressures are set to…', options: ['Whatever they were', 'The door-jamb spec', '40 psi always', 'Max sidewall'], correct: 1 },
    { id: 'q2', q: 'Which of these is part of the safety inspection?', options: ['Wiper blades', 'Seat belts and airbag system', 'Cabin filter', 'Oil level'], correct: 1 },
  ] },
  { id: 'timeclock', tracks: ['core'], title: 'Time clock, pay periods, time off', minutes: 6, video_url: '', reading: `Clock in when you start, out when you're done, every day, in the app. Forgot? The app auto-closes at 5pm and Mark gets a note — fix it with an edit request, Mark approves.

Pay periods are the 1st–15th and the 16th–end of month. On the 15th and the last day you'll be asked to review and approve your time card. Overtime is anything past 40 hours in a Monday–Sunday week (W-2). Sick leave: 1 hour earned per 40 worked. Five paid holidays. Request time off on the Time Off page.`, quiz: [
    { id: 'q1', q: 'When are the pay periods?', options: ['Weekly', 'Every two weeks', '1st–15th and 16th–end of month', 'Monthly'], correct: 2 },
    { id: 'q2', q: 'You forgot to clock out yesterday. What now?', options: ['Nothing', 'Send an edit request in the app — Mark approves', 'Text Joyce', 'Clock in twice today'], correct: 1 },
    { id: 'q3', q: 'How is sick leave earned?', options: ['8 hours a month', '1 hour per 40 hours worked', 'Only after a year', 'It is not offered'], correct: 1 },
  ] },
  { id: 'big3', tracks: ['core'], title: 'Big 3 rules and what goes on the invoice', minutes: 6, video_url: '', reading: `Every invoice carries the Cal ID report, the post-collision safety inspection and the post-scan. Per shop, each is either charged or shown as included at $0 — that's the shop's Big 3 rule, saved in the CRM. You don't set prices; you make sure the work behind each line actually happened and is in the photos.`, quiz: [
    { id: 'q1', q: 'The Big 3 are…', options: ['Three techs', 'Cal ID report, post-collision safety inspection, post-scan', 'Three insurers', 'Three vans'], correct: 1 },
    { id: 'q2', q: 'Who sets whether a shop is charged for the Big 3?', options: ['The tech on site', 'The rule saved on the shop in the CRM (Kat/Mark)', 'The insurer', 'The customer'], correct: 1 },
  ] },
  { id: 'safety', tracks: ['tech', 'apprentice'], title: 'Safety, the van, and the shop floor', minutes: 6, video_url: '', reading: `Wheel chocks on. Targets and rig set on level ground. Nothing on the shop floor that a lift or a tech can hit. Keys and fobs go back to the advisor, never left in the car. The van is locked when you're not at it, tools inventoried at the end of the day.

If something feels unsafe, stop and call Mark. Nobody has ever been in trouble for that.`, quiz: [
    { id: 'q1', q: 'Where do the keys go when you are done?', options: ['On the seat', 'Back to the advisor', 'In the van', 'On the dash'], correct: 1 },
    { id: 'q2', q: 'Something feels unsafe. You…', options: ['Push through', 'Stop and call Mark', 'Ask the shop to sign a waiver', 'Finish, then report'], correct: 1 },
  ] },
  { id: 'customer', tracks: ['core'], title: 'Talking to the shop and the customer', minutes: 5, video_url: '', reading: `You are the company while you're on site. Introduce yourself, say what you're going to do and how long it takes, and tell the advisor when you're done. If the car needs something we can't do, say so plainly and let Kat quote it.

Customer-pay jobs: if the advisor says "this is customer pay" or gives you a number, put it on the card right away so Kat bills it right.`, quiz: [
    { id: 'q1', q: 'The advisor says the job is customer pay at $700. You…', options: ['Ignore it — billing is Kat\'s job', 'Put it on the card right away so Kat bills it right', 'Collect cash', 'Tell the customer to call the office'], correct: 1 },
    { id: 'q2', q: 'The car needs work we can\'t do. You…', options: ['Try anyway', 'Say so plainly and let Kat quote it', 'Say nothing', 'Send them to the dealer'], correct: 1 },
  ] },
  { id: 'apprentice', tracks: ['apprentice'], title: 'How your apprenticeship works', minutes: 5, video_url: '', reading: `You ride with a technician until you're signed off to run jobs alone. Your profile has a skills ladder — each rung is a type of calibration you do under supervision a set number of times. The tech you ride with signs each one off in the app.

Ask questions on every car. Take the photo set yourself from day one. When every rung is signed off, Mark promotes you to ADAS Calibration Technician.`, quiz: [
    { id: 'q1', q: 'Who signs off a rung on your ladder?', options: ['You', 'The technician or Mark who supervised it', 'The shop', 'Kat'], correct: 1 },
    { id: 'q2', q: 'When do you start taking the photo set yourself?', options: ['After promotion', 'Day one', 'After a month', 'Never — the tech does it'], correct: 1 },
  ] },
  { id: 'ops_books', tracks: ['ops'], title: 'Invoicing in Zoho Books + Bill it', minutes: 10, video_url: '', reading: `Every calibration becomes a Books invoice. Techs press "Bill it" at Ready to Invoice: the app builds the estimate for the insurer and the discounted cost invoice for the shop from the shop's rules. Your job is the review: right shop, right RO number, right vehicle, Big 3 lines correct, cash cap applied on customer-pay jobs, then send.

Never change a calibration price on your own — pricing lives in Books and only Mark changes it.`, quiz: [
    { id: 'q1', q: 'Who changes calibration prices?', options: ['Whoever is invoicing', 'Mark only', 'The tech', 'The insurer'], correct: 1 },
    { id: 'q2', q: 'What does "Bill it" build?', options: ['Only a receipt', 'The insurer estimate and the discounted cost invoice for the shop', 'A quote for the customer', 'A CRM note'], correct: 1 },
  ] },
  { id: 'ops_big3', tracks: ['ops'], title: 'Applying Big 3 rules and quotes', minutes: 8, video_url: '', reading: `Each shop has a Big 3 rule saved in the CRM (Billing tab): Cal ID report, post-collision safety inspection, post-scan — charged or included. The invoice preview applies it for you; if a shop has no rule yet, the first invoice asks you and saves your pick as the rule.

Quotes for pre-repair work go out from the Quotes board as Books quotes on the "Quote" template. Approved quotes flow into dual billing.`, quiz: [
    { id: 'q1', q: 'A shop has no Big 3 rule yet. What happens on their first invoice?', options: ['It fails', 'The app asks you and saves your pick as the rule', 'Mark is called', 'The lines are left off'], correct: 1 },
    { id: 'q2', q: 'Where do pre-repair quotes go out from?', options: ['Email by hand', 'The Quotes board as Books quotes', 'Text', 'The CRM'], correct: 1 },
  ] },
  { id: 'ops_dispatch', tracks: ['ops'], title: 'Dispatch board and scheduling', minutes: 8, video_url: '', reading: `Jobs arrive from the website form, phone, text and email. They land as Job Requested cards. You confirm the shop, vehicle, RO number and the calibrations, then dispatch to a tech and a day. The tech's Live Day shows their route; the Map shows who's where.

Confirm every booking back to the shop (the confirm toggle texts them). If a tech is running late, the shop hears it from you first.`, quiz: [
    { id: 'q1', q: 'A new request lands. First thing you check?', options: ['The tech\'s mood', 'Shop, vehicle, RO number and the calibrations', 'The weather', 'The invoice total'], correct: 1 },
    { id: 'q2', q: 'A tech is running late. Who tells the shop?', options: ['Nobody', 'The tech when he arrives', 'You, before the shop asks', 'Mark'], correct: 2 },
  ] },
  { id: 'ops_cash', tracks: ['ops'], title: 'Customer pay, insurers and hard questions', minutes: 6, video_url: '', reading: `Customer-pay jobs use the cash schedule with a hard cap; the card shows CASH and the amount the customer was told. Never bill a cash customer above the number they were quoted.

Insurers ask "why was this calibration needed?" — the answer is on the invoice justification and in the photos. Pull the report, don't guess. Anything about pricing disputes goes to Mark.`, quiz: [
    { id: 'q1', q: 'A cash customer was told $700. The invoice comes to $850. You…', options: ['Bill $850', 'Bill $700 — never above the quoted number', 'Split the difference', 'Ask the shop'], correct: 1 },
    { id: 'q2', q: 'An insurer asks why a calibration was needed. You…', options: ['Guess', 'Pull the report and photos — the justification is there', 'Refund it', 'Ignore it'], correct: 1 },
  ] },
  { id: 'ops_crm', tracks: ['ops'], title: 'The CRM and follow-ups', minutes: 6, video_url: '', reading: `Every body shop we know is a card in the CRM, in a zone and a stage. After a sales stop or a call, log it on the card and set the next action. The Monday list tells Mark and Jayden who's gone quiet. Big 3 rules and DRP info live on the shop's Billing tab.`, quiz: [
    { id: 'q1', q: 'After a call with a shop you…', options: ['Remember it', 'Log it on the card and set the next action', 'Text Mark', 'Nothing'], correct: 1 },
  ] },
] }
