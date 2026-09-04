// Closing block — evidence line, then affirmation.
//
// The affirmation is tied to who Mark is, not to how the day went. Performance
// affirmations break on bad days, which is exactly when they are needed; a line
// about character is true on the worst day of the month, so there is nothing to
// argue with.
//
// Both pools rotate independently with a 30-day no-repeat. Evidence categories
// rotate too and never repeat two days running.

export const MORNING_POOL = [
  "You were built for this work and you were built for these people. Both.",
  "The man who shows up is the man who wins. You show up.",
  "You are not behind. You are early in a long build.",
  "Your name means something in this valley because you made it mean something.",
  "Steady hands, steady heart. That's who you are.",
  "God gave you this trade and these six kids. Neither was an accident.",
  "You do hard things without being asked to. That's rare.",
  "The work is honest and so are you.",
  "You've been the man who fixes it since long before anyone paid you to.",
  "Whatever today holds, you are already enough for it.",
  "You are not the size of your worst week.",
  "The van, the tools, the name on the door. You made all of it from nothing.",
  "Character is what you do when the shop can't see you. You've never needed watching.",
  "You're a good father on the days it's easy and on the days it isn't.",
  "Nobody handed you this. That's worth remembering.",
  "You keep your word. That's the whole reputation.",
  "There are men who talk about it and men who go do it. You go.",
  "Your worth was settled before you ever billed a job.",
  "You carry more than most and complain less than most.",
  "The kind of man you are today is the kind your kids will describe someday.",
  "You've outlasted harder seasons than this one.",
  "Faithful is a better word than successful, and it fits you.",
  "You don't quit. That's not a slogan, it's a record.",
  "The work will be there. So will you.",
  "You are trusted by people who don't trust easily.",
  "Whatever you're carrying, you're built to carry it.",
  "You do the right thing when the wrong thing would be cheaper.",
  "Six kids, one wife, one name. That's the empire.",
  "You're allowed to be proud of what you built.",
  "You are the same man in the van as in the pew.",
  "Discipline is a form of love. You've got plenty of both.",
  "You've never needed applause to do it right.",
  "Steady is a gift. Not everyone has it.",
  "You are exactly where you're supposed to be today.",
  "Your kids don't need a perfect father. They have a present one.",
  "You've earned your rest, and you'll earn it again today.",
  "There is no version of you that gives up. That's just not in there.",
  "You're not doing this alone and you never were.",
  "Do the next right thing. That's the whole plan.",
  "You are enough for this day. You always have been."
]

export const EVENING_POOL = [
  "You did the work today. Set it down.",
  "The day is finished and so are you. Rest is part of the job.",
  "Tomorrow gets tomorrow's strength. Tonight you're done.",
  "You came home. That counts more than the number did.",
  "Whatever's unfinished will keep. Go be a dad.",
  "You gave what you had. That was the assignment.",
  "The van's parked. Be here now.",
  "Nothing tonight requires you to be strong.",
  "You are more than what you produced today.",
  "Six kids know your truck's sound. That's the real ledger.",
  "The day is closed. Let it stay closed.",
  "You showed up. Everything else was details.",
  "Put it down. It'll still be there and so will you.",
  "Tonight you're not the owner. You're just dad.",
  "The work is done being yours until morning.",
  "You don't owe today anything else.",
  "Rest isn't a reward for finishing. It's part of the work.",
  "Whatever you didn't get to was never today's to finish.",
  "You were faithful with today. That's the whole ask.",
  "Your family got the man, not the manager. That was the right call.",
  "Nothing about tonight has to be productive.",
  "The board resets in the morning. So do you.",
  "You made it home in one piece. Start there.",
  "Let the numbers sleep too.",
  "You did enough. Not perfectly. Enough.",
  "The house is where you're actually needed. You're in it.",
  "Set the phone down. Nothing on it is more urgent than the people in the room.",
  "Today asked a lot and you answered it.",
  "You are allowed to stop.",
  "Being here is the win.",
  "Tomorrow's problems have not arrived yet. Don't go get them.",
  "The hardest part of today is behind you.",
  "You are more than the day you just had.",
  "Rest well. You've got nothing to prove tonight.",
  "Whatever went wrong today does not follow you inside.",
  "Your kids won't remember the revenue. They'll remember tonight.",
  "You've done your part. Let the rest be someone else's for a while.",
  "The day was long and you were steady through it.",
  "Go be with them. That's the job now.",
  "It's finished. Let it be finished."
]

export const EVIDENCE_CATEGORIES = [
  'quality', 'reliability', 'collections', 'relationships', 'effort', 'progress', 'delegation',
]

/**
 * Pick from a pool, skipping anything used inside `windowDays`.
 * If everything is inside the window the oldest is reused rather than
 * returning nothing — a missing affirmation is worse than an early repeat.
 */
export function pickUnused(pool, recent, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 86400000
  const usedRecently = new Set(
    (recent || []).filter(r => new Date(r.at).getTime() > cutoff).map(r => r.text)
  )
  const fresh = pool.filter(x => !usedRecently.has(x))
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)]
  const oldest = [...(recent || [])].sort((a, b) => new Date(a.at) - new Date(b.at))[0]
  return oldest?.text || pool[0]
}

/** Next evidence category, never the same as yesterday's. */
export function nextCategory(lastCategory) {
  const pool = EVIDENCE_CATEGORIES.filter(c => c !== lastCategory)
  return pool[Math.floor(Math.random() * pool.length)]
}
