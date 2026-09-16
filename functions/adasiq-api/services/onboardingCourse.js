// Default onboarding course (Mark 2026-09-16: "onboarding videos, onboarding
// workflow with some training and Q&A… I want this to be proper"). Stored in
// AppConfig `onboarding_course`; Mark + Kat edit it in Directory → Training.
// video_url is blank until Mark records/links one (YouTube, Loom, WorkDrive).
export const DEFAULT_COURSE = { version: 1, pass_pct: 80, modules: [
  { id: 'welcome', title: 'Welcome to Absolute ADAS', minutes: 5, video_url: '', reading: `Absolute ADAS is a mobile ADAS calibration company. We go to the body shop, calibrate the car's driver-assist systems after a repair, prove it with photos and reports, and the shop gets the car back the same day.

Our promise is on the van: SAME DAY. DONE RIGHT. Every job is judged on two things — did we show up when we said we would, and can the shop hand the insurer a clean report without questions.

You report to Mark. Kat runs dispatch and billing. Joyce keeps the books. GET SOME!!!`, quiz: [
    { id: 'q1', q: 'What do we do?', options: ['Sell ADAS parts', 'Calibrate driver-assist systems at the body shop after a repair', 'Repair collision damage', 'Tow vehicles to the dealer'], correct: 1 },
    { id: 'q2', q: 'Who runs dispatch and billing?', options: ['Mark', 'Joyce', 'Kat', 'The shop'], correct: 2 },
    { id: 'q3', q: 'Our promise is…', options: ['Cheapest in town', 'Same day. Done right.', 'Next-day service', 'Dealer quality'], correct: 1 },
  ] },
  { id: 'jobflow', title: 'How a job flows through the app', minutes: 8, video_url: '', reading: `Every job lives on a card in the app. It moves: Job Requested → Dispatched → (Pending parts / Need dispatch) → Ready to Invoice → Completed.

Your part: open the card when you arrive, clock in, take the photo set, do the calibration, do the post-collision safety inspection, set tire pressures, and move the card to Ready to Invoice. Kat takes it from there.

Never move a card to Ready to Invoice with photos or the safety inspection missing — the app will stop you, and so will Mark.`, quiz: [
    { id: 'q1', q: 'Which stage does the tech move the card to when the car is done?', options: ['Completed', 'Ready to Invoice', 'Dispatched', 'Invoiced'], correct: 1 },
    { id: 'q2', q: 'What must be finished before Ready to Invoice?', options: ['Only the calibration', 'Photos + post-collision safety inspection + tire pressures', 'A phone call to the insurer', 'Nothing, Kat checks later'], correct: 1 },
  ] },
  { id: 'photos', title: 'The photo set (8 shots, every car)', minutes: 10, video_url: '', reading: `Eight photos on every job, in the app, in order: 1) odometer before, 2) VIN plate, 3) left front corner, 4) right front corner, 5) right rear corner, 6) left rear corner, 7) calibration setup (as many as you like), 8) odometer after the test drive.

The odometer shots prove the test drive (more than 1 mile). The corners prove the car's condition when we touched it. The setup photos prove the calibration was done to spec. The app reads the VIN and mileage for you.

Photos are saved on your phone first and upload on their own — if the signal is bad, keep working.`, quiz: [
    { id: 'q1', q: 'How many required shots are in the set?', options: ['4', '6', '8', '12'], correct: 2 },
    { id: 'q2', q: 'Why two odometer photos?', options: ['To bill mileage', 'To prove the test drive of more than 1 mile', 'Insurance requires it', 'To check the VIN'], correct: 1 },
    { id: 'q3', q: 'The signal drops mid-upload. What do you do?', options: ['Re-shoot everything', 'Keep working — photos are saved on the phone and upload on their own', 'Text Kat the photos', 'Skip the photos'], correct: 1 },
  ] },
  { id: 'pcsi', title: 'Post-collision safety inspection + tires', minutes: 8, video_url: '', reading: `After a collision repair we confirm the safety systems: seat belts (retract and latch), airbag system (no lights, no codes), and tire pressures set to the door-jamb spec (commonly 36/36). It's a checklist on the Ready to Invoice screen.

It's not paperwork. It's the reason the shop's insurer accepts our invoice and the reason the car is safe to give back.`, quiz: [
    { id: 'q1', q: 'Tire pressures are set to…', options: ['Whatever they were', 'The door-jamb spec', '40 psi always', 'Max sidewall'], correct: 1 },
    { id: 'q2', q: 'Which of these is part of the safety inspection?', options: ['Wiper blades', 'Seat belts and airbag system', 'Cabin filter', 'Oil level'], correct: 1 },
  ] },
  { id: 'timeclock', title: 'Time clock, pay periods, time off', minutes: 6, video_url: '', reading: `Clock in when you start, out when you're done, every day, in the app. Forgot? The app auto-closes at 5pm and Mark gets a note — fix it with an edit request, Mark approves.

Pay periods are the 1st–15th and the 16th–end of month. On the 15th and the last day you'll be asked to review and approve your time card. Overtime is anything past 40 hours in a Monday–Sunday week (W-2). Sick leave: 1 hour earned per 40 worked. Five paid holidays. Request time off on the Time Off page.`, quiz: [
    { id: 'q1', q: 'When are the pay periods?', options: ['Weekly', 'Every two weeks', '1st–15th and 16th–end of month', 'Monthly'], correct: 2 },
    { id: 'q2', q: 'You forgot to clock out yesterday. What now?', options: ['Nothing', 'Send an edit request in the app — Mark approves', 'Text Joyce', 'Clock in twice today'], correct: 1 },
    { id: 'q3', q: 'How is sick leave earned?', options: ['8 hours a month', '1 hour per 40 hours worked', 'Only after a year', 'It is not offered'], correct: 1 },
  ] },
  { id: 'big3', title: 'Big 3 rules and what goes on the invoice', minutes: 6, video_url: '', reading: `Every invoice carries the Cal ID report, the post-collision safety inspection and the post-scan. Per shop, each is either charged or shown as included at $0 — that's the shop's Big 3 rule, saved in the CRM. You don't set prices; you make sure the work behind each line actually happened and is in the photos.`, quiz: [
    { id: 'q1', q: 'The Big 3 are…', options: ['Three techs', 'Cal ID report, post-collision safety inspection, post-scan', 'Three insurers', 'Three vans'], correct: 1 },
    { id: 'q2', q: 'Who sets whether a shop is charged for the Big 3?', options: ['The tech on site', 'The rule saved on the shop in the CRM (Kat/Mark)', 'The insurer', 'The customer'], correct: 1 },
  ] },
  { id: 'safety', title: 'Safety, the van, and the shop floor', minutes: 6, video_url: '', reading: `Wheel chocks on. Targets and rig set on level ground. Nothing on the shop floor that a lift or a tech can hit. Keys and fobs go back to the advisor, never left in the car. The van is locked when you're not at it, tools inventoried at the end of the day.

If something feels unsafe, stop and call Mark. Nobody has ever been in trouble for that.`, quiz: [
    { id: 'q1', q: 'Where do the keys go when you are done?', options: ['On the seat', 'Back to the advisor', 'In the van', 'On the dash'], correct: 1 },
    { id: 'q2', q: 'Something feels unsafe. You…', options: ['Push through', 'Stop and call Mark', 'Ask the shop to sign a waiver', 'Finish, then report'], correct: 1 },
  ] },
  { id: 'customer', title: 'Talking to the shop and the customer', minutes: 5, video_url: '', reading: `You are the company while you're on site. Introduce yourself, say what you're going to do and how long it takes, and tell the advisor when you're done. If the car needs something we can't do, say so plainly and let Kat quote it.

Customer-pay jobs: if the advisor says "this is customer pay" or gives you a number, put it on the card right away so Kat bills it right.`, quiz: [
    { id: 'q1', q: 'The advisor says the job is customer pay at $700. You…', options: ['Ignore it — billing is Kat\'s job', 'Put it on the card right away so Kat bills it right', 'Collect cash', 'Tell the customer to call the office'], correct: 1 },
    { id: 'q2', q: 'The car needs work we can\'t do. You…', options: ['Try anyway', 'Say so plainly and let Kat quote it', 'Say nothing', 'Send them to the dealer'], correct: 1 },
  ] },
] }
