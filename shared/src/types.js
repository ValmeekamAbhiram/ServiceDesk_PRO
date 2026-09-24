/**
 * ServiceDesk Pro — shared DTO contract.
 *
 * The exact JSON shape crossing the wire. The server returns these; the client
 * consumes them; neither guesses. Two conventions hold throughout:
 *
 *  - **Ids are strings.** `ObjectId` is a server-side concern and never leaks
 *    into a DTO, so the client never has to know what a BSON type is.
 *  - **Dates are ISO 8601 strings.** `JSON.parse` does not revive `Date`, so a
 *    DTO typed `Date` would be a lie the moment it left the server. The client
 *    parses at the point of display.
 *
 * DTOs are also where **derived** values live. `slaResponseRemainingMs` is not
 * stored anywhere — it is computed per request from the deadline and the current
 * clock, so the UI never has to reimplement SLA arithmetic to draw a countdown.
 */
export {};
