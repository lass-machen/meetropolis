/**
 * Longest display name the server accepts or shows: 200 characters, the cap the
 * NPC routes already put on `Npc.name`. One constant for every writer of a name
 * (users, guests, NPCs), for the clamp a world join applies to a name on its way
 * into the room state, and for the `maxLength` of the name fields in the web
 * client, so the form and the API cannot drift apart.
 */
export const MAX_DISPLAY_NAME_LENGTH = 200;
