// Magic Lantern image-prompt library stub.
//
// services/metaDrafter.js imports { MAGIC_LANTERN_LIBRARY, MAGIC_LANTERN_ROUTING_BLOCK }
// from this module. The real 40-prompt library was defined in the memory
// notes (2026-05-26) but the actual file was never checked into this
// environment — its absence takes the whole adasiq-api function offline
// with ERR_MODULE_NOT_FOUND.
//
// Empty defaults let metaDrafter.js load. The drafter will produce posts
// without the Magic Lantern image prompts until the real library is
// restored — an acceptable degradation to keep the app online.

export const MAGIC_LANTERN_LIBRARY = []

export const MAGIC_LANTERN_ROUTING_BLOCK = ''
