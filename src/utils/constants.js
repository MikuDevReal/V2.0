module.exports = {
      PORT: process.env.PORT || 2893,
  WS_PORT: process.env.WS_PORT || 2893,
  // WhatsApp bug types
  BUGS: [
    { bug_id: "delay", bug_name: "DELAY INVISIBLE" },
    { bug_id: "spam", bug_name: "DELAY X BULDO" },
    { bug_id: "crash", bug_name: "CRASH ANDROID" },
 //   { bug_id: "uix", bug_name: "CRASH X UI" },
    { bug_id: "bokep", bug_name: "CRASH X UI" },
    { bug_id: "ios", bug_name: "CRASH IOS" },
 //   { bug_id: "fcinvis", bug_name: "CRASH INVISIBLE" },
 //   { bug_id: "fcnoinvis", bug_name: "FORCE CLOSE HARD" }
  ],
    
  payload: [
    { bug_id: "XMml", bug_name: "CRASH ANDROID" },
    { bug_id: "FreezePackk", bug_name: "FREEZE CLICK" },
    { bug_id: "killeruimsg", bug_name: "KILLER UI" },
    { bug_id: "RaysDocuStunt", bug_name: "DELAY INVISIBLE" },
    { bug_id: "xCursedCrawl", bug_name: "DELAY INVISIBLE 2" },
    { bug_id: "xCursedCrott", bug_name: "DELAY INVISIBLE 3" },
    { bug_id: "XiosSejaya", bug_name: "CRASH IOS" },
    { bug_id: "fcinvis", bug_name: "CRASH INVISIBLE (NOT ALL DEVICE)" },
    { bug_id: "fcinvisotax", bug_name: "CRASH CALL" },
    { bug_id: "FriendBerulah", bug_name: "FC 1 MSG" },
    { bug_id: "permenCall", bug_name: "SPAM TELPON" },
    { bug_id: "XCursedNFBlank", bug_name: "CRASH" }
  ],
    
  DDOS: [
    { ddos_id: "s-gbps", ddos_name: "SYN High GBPS" },
    { ddos_id: "s-pps", ddos_name: "SYN Traffic Flood" },
    { ddos_id: "a-gbps", ddos_name: "ACK High GBPS" },
    { ddos_id: "a-pps", ddos_name: "ACK Traffic Flood" },
    { ddos_id: "icmp", ddos_name: "ICMP Flood" },
    { ddos_id: "udp", ddos_name: "GUDP ( HIGH RISK )" }

  ],
  // News data
  NEWS: [
    {
      image: "https://a.top4top.io/p_3696nya4z1.jpg",
      title: "ParapamX",
      desc: "-1 Cewe yang hot"
    }
  ],
  // Role cooldowns (in seconds)
  ROLE_COOLDOWNS: {
    member: 300,
    reseller: 240,
    reseller1: 60,
    owner: 0,
    vip: 60,
  },
  // Max quantities by role
  MAX_QUANTITIES: {
    member: 5,
    reseller: 5,
    reseller1: 5,
    owner: 10,
    vip: 10,
  }
};
