import { DialogueTree } from "../types";

/** All dialogue trees, keyed by ID */
const DIALOGUES: Record<string, DialogueTree> = {
  sheriff_intro: {
    id: "sheriff_intro",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Sheriff Morgan",
        text: "Well now... another wanderer stumbles into Dusty Springs. You look like you've been walking for days. I'm Sheriff Morgan — I keep what little order there is around here.",
        responses: [
          { text: "What is this place?", nextNodeId: "about_town" },
          { text: "I'm looking for work.", nextNodeId: "work" },
          { text: "Any trouble around here?", nextNodeId: "trouble" },
          { text: "I'll be on my way. [Leave]", nextNodeId: null },
        ],
      },
      about_town: {
        id: "about_town",
        speaker: "Sheriff Morgan",
        text: "Dusty Springs — what's left of it. Used to be a proper settlement before the raiders hit us last season. We've got a doc, a trader, and about twenty souls trying to survive. Not much, but it's home.",
        responses: [
          { text: "Tell me about the raiders.", nextNodeId: "trouble" },
          { text: "Where can I trade?", nextNodeId: "trade_info" },
          { text: "Thanks. [Leave]", nextNodeId: null },
        ],
      },
      trouble: {
        id: "trouble",
        speaker: "Sheriff Morgan",
        text: "Raiders. A gang of them set up camp to the northwest. They've been picking off anyone who wanders too far from town. I'd deal with them myself, but... I can't leave these people unprotected. If you're handy with a gun, I could make it worth your while.",
        responses: [
          { text: "I'll take care of them. What's the pay?", nextNodeId: "quest_accept" },
          { text: "That's not my problem.", nextNodeId: "quest_decline" },
          { text: "I need to think about it. [Leave]", nextNodeId: null },
        ],
      },
      quest_accept: {
        id: "quest_accept",
        speaker: "Sheriff Morgan",
        text: "Fifty caps and a stimpak up front. Clear them out, and there's another hundred caps waiting for you. Here — take this. You'll need it more than me.",
        responses: [
          { text: "[Take the stimpak] Consider it done.", nextNodeId: null, giveItem: "stimpak" },
        ],
      },
      quest_decline: {
        id: "quest_decline",
        speaker: "Sheriff Morgan",
        text: "Can't say I blame you. Just... watch yourself out there. The wasteland doesn't care about anyone.",
        responses: [
          { text: "[Leave]", nextNodeId: null },
        ],
      },
      work: {
        id: "work",
        speaker: "Sheriff Morgan",
        text: "Work? In this economy? *laughs dryly* Well, there's always raiders that need killing and scrap that needs hauling. Talk to Scrapper Joe by the trading post — he might have something for you.",
        responses: [
          { text: "Tell me about the raiders.", nextNodeId: "trouble" },
          { text: "Where's the trading post?", nextNodeId: "trade_info" },
          { text: "Thanks. [Leave]", nextNodeId: null },
        ],
      },
      trade_info: {
        id: "trade_info",
        speaker: "Sheriff Morgan",
        text: "Scrapper Joe runs the trading post just south of here. He's a fair dealer — for a wasteland merchant, anyway. If you've got caps or salvage, he'll set you up.",
        responses: [
          { text: "Anything else I should know?", nextNodeId: "trouble" },
          { text: "Thanks. [Leave]", nextNodeId: null },
        ],
      },
    },
  },

  merchant_intro: {
    id: "merchant_intro",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Scrapper Joe",
        text: "Hey hey! Fresh face in town! Name's Joe — Scrapper Joe. I deal in all manner of pre-war goods, salvage, and survival essentials. What can I do for you?",
        responses: [
          { text: "What do you have for sale?", nextNodeId: "inventory" },
          { text: "I have some things to trade.", nextNodeId: "trade" },
          { text: "Know anything useful about the area?", nextNodeId: "info" },
          { text: "Just looking. [Leave]", nextNodeId: null },
        ],
      },
      inventory: {
        id: "inventory",
        speaker: "Scrapper Joe",
        text: "Stimpaks, Nuka-Cola, some ammo... I even got a nice piece of leather armor if you've got the caps. Prices are fair — fairer than you'll find anywhere else in the wastes, I guarantee it.",
        responses: [
          { text: "[Buy] Stimpak — 25 caps", nextNodeId: "buy_stimpak" },
          { text: "[Buy] Nuka-Cola — 10 caps", nextNodeId: "buy_nuka" },
          { text: "Maybe later. [Leave]", nextNodeId: null },
        ],
      },
      buy_stimpak: {
        id: "buy_stimpak",
        speaker: "Scrapper Joe",
        text: "Smart choice. A stimpak's saved my life more times than I can count. Here you go — try not to need it too soon, eh?",
        responses: [
          { text: "[Take stimpak] Thanks.", nextNodeId: "start", giveItem: "stimpak" },
        ],
      },
      buy_nuka: {
        id: "buy_nuka",
        speaker: "Scrapper Joe",
        text: "Ah, a connoisseur! Nothing beats a cold Nuka-Cola after a long day of not dying. Enjoy!",
        responses: [
          { text: "[Take Nuka-Cola] Cheers.", nextNodeId: "start", giveItem: "nuka_cola" },
        ],
      },
      trade: {
        id: "trade",
        speaker: "Scrapper Joe",
        text: "Let me see what you've got... Hmm. I'll give you a fair price for anything useful. Weapons, chems, pre-war junk — I'll take it all.",
        responses: [
          { text: "What are you looking for specifically?", nextNodeId: "want_list" },
          { text: "Never mind. [Leave]", nextNodeId: null },
        ],
      },
      want_list: {
        id: "want_list",
        speaker: "Scrapper Joe",
        text: "Anything from the old world, really. Weapons fetch the best price. Medical supplies are always in demand. And if you find any holotapes or tech... well, let's just say I know people who pay premium for that kind of thing.",
        responses: [
          { text: "I'll keep an eye out.", nextNodeId: null },
        ],
      },
      info: {
        id: "info",
        speaker: "Scrapper Joe",
        text: "Word of advice — don't go northwest. Raiders have a camp up there, and they don't take kindly to visitors. South and east are safer, but you'll run into wildlife. The road heading east leads to New Flagstaff, if you can survive the trip.",
        responses: [
          { text: "Thanks for the tip.", nextNodeId: "start" },
          { text: "I can handle myself. [Leave]", nextNodeId: null },
        ],
      },
    },
  },

  doc_intro: {
    id: "doc_intro",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Doc Hendricks",
        text: "*adjusts glasses* Ah, a new patient — I mean, visitor. I'm Dr. Hendricks. I run the clinic here, such as it is. Are you injured?",
        responses: [
          { text: "I could use some healing.", nextNodeId: "heal" },
          { text: "I'm fine. What can you tell me about Dusty Springs?", nextNodeId: "town_info" },
          { text: "I'm fine, thanks. [Leave]", nextNodeId: null },
        ],
      },
      heal: {
        id: "heal",
        speaker: "Doc Hendricks",
        text: "Let me take a look... *examines you* Nothing a stimpak won't fix. I'll patch you up — no charge for first-timers. Consider it a welcome gift.",
        responses: [
          { text: "[Get healed] Thank you, Doc.", nextNodeId: "post_heal", giveItem: "stimpak" },
        ],
      },
      post_heal: {
        id: "post_heal",
        speaker: "Doc Hendricks",
        text: "There you go, good as new. Well... good as this wasteland allows. Be careful out there — I'm running low on supplies as it is.",
        responses: [
          { text: "Where do you get your supplies?", nextNodeId: "supplies" },
          { text: "Thanks, Doc. [Leave]", nextNodeId: null },
        ],
      },
      supplies: {
        id: "supplies",
        speaker: "Doc Hendricks",
        text: "Used to get regular shipments from the east. But with the raiders blocking the roads... *sighs* If someone could clear that route, it would save a lot of lives. Mine included.",
        responses: [
          { text: "I'll see what I can do.", nextNodeId: null },
          { text: "Good luck with that. [Leave]", nextNodeId: null },
        ],
      },
      town_info: {
        id: "town_info",
        speaker: "Doc Hendricks",
        text: "Dusty Springs is... resilient. We lost a lot of people in the last raid, but we're rebuilding. Sheriff Morgan keeps us safe, Joe keeps us supplied, and I keep everyone patched up. It's not much of a life, but it's ours.",
        responses: [
          { text: "How long have you been here?", nextNodeId: "backstory" },
          { text: "Take care, Doc. [Leave]", nextNodeId: null },
        ],
      },
      backstory: {
        id: "backstory",
        speaker: "Doc Hendricks",
        text: "Fifteen years. I was a researcher at a university before the bombs — biology, genetics. Not much use for gene therapy in the wasteland, but a doctor's a doctor. These people need me.",
        responses: [
          { text: "That's admirable.", nextNodeId: null },
          { text: "Good luck. [Leave]", nextNodeId: null },
        ],
      },
    },
  },
};

export class DialogueSystem {
  getDialogue(id: string): DialogueTree | null {
    return DIALOGUES[id] ?? null;
  }
}
