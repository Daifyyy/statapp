// Crosswalk Transfermarkt club_id → API-Football team id (+ naše leagueId) pro top-5 ligy.
// Vygenerováno scripts/buildCrosswalk.ts (match dle názvu) + ruční kontrola kolizí
// (AC Milan vs Inter) a doplnění zkratek (Wolves, Auxerre, Rennes, RB Leipzig, AS Roma).
// Slouží k navázání přestupů z TM datasetu na naše kluby/logy. Aktualizovat při změně lig.

export interface CrosswalkEntry {
  apiId: number;
  leagueId: number;
}

export const TM_TO_API: Record<number, CrosswalkEntry> = {
  // Premier League (39)
  11: { apiId: 42, leagueId: 39 }, // Arsenal
  405: { apiId: 66, leagueId: 39 }, // Aston Villa
  989: { apiId: 35, leagueId: 39 }, // Bournemouth
  1148: { apiId: 55, leagueId: 39 }, // Brentford
  1237: { apiId: 51, leagueId: 39 }, // Brighton
  1132: { apiId: 44, leagueId: 39 }, // Burnley
  873: { apiId: 52, leagueId: 39 }, // Crystal Palace
  29: { apiId: 45, leagueId: 39 }, // Everton
  931: { apiId: 36, leagueId: 39 }, // Fulham
  631: { apiId: 49, leagueId: 39 }, // Chelsea
  399: { apiId: 63, leagueId: 39 }, // Leeds
  31: { apiId: 40, leagueId: 39 }, // Liverpool
  281: { apiId: 50, leagueId: 39 }, // Manchester City
  985: { apiId: 33, leagueId: 39 }, // Manchester United
  762: { apiId: 34, leagueId: 39 }, // Newcastle
  703: { apiId: 65, leagueId: 39 }, // Nottingham Forest
  289: { apiId: 746, leagueId: 39 }, // Sunderland
  148: { apiId: 47, leagueId: 39 }, // Tottenham
  379: { apiId: 48, leagueId: 39 }, // West Ham
  543: { apiId: 39, leagueId: 39 }, // Wolves (ruční)

  // Ligue 1 (61)
  1420: { apiId: 77, leagueId: 61 }, // Angers
  290: { apiId: 108, leagueId: 61 }, // Auxerre (ruční)
  3911: { apiId: 106, leagueId: 61 }, // Stade Brestois 29
  738: { apiId: 111, leagueId: 61 }, // Le Havre
  826: { apiId: 116, leagueId: 61 }, // Lens
  1082: { apiId: 79, leagueId: 61 }, // Lille
  1158: { apiId: 97, leagueId: 61 }, // Lorient
  1041: { apiId: 80, leagueId: 61 }, // Lyon
  244: { apiId: 81, leagueId: 61 }, // Marseille
  347: { apiId: 112, leagueId: 61 }, // Metz
  162: { apiId: 91, leagueId: 61 }, // Monaco
  995: { apiId: 83, leagueId: 61 }, // Nantes
  417: { apiId: 84, leagueId: 61 }, // Nice
  10004: { apiId: 114, leagueId: 61 }, // Paris FC
  583: { apiId: 85, leagueId: 61 }, // Paris Saint-Germain
  273: { apiId: 94, leagueId: 61 }, // Rennes (ruční)
  618: { apiId: 1063, leagueId: 61 }, // Saint-Étienne
  667: { apiId: 95, leagueId: 61 }, // Strasbourg
  415: { apiId: 96, leagueId: 61 }, // Toulouse

  // Bundesliga (78)
  2036: { apiId: 180, leagueId: 78 }, // 1. FC Heidenheim
  3: { apiId: 192, leagueId: 78 }, // 1. FC Köln
  533: { apiId: 167, leagueId: 78 }, // 1899 Hoffenheim
  15: { apiId: 168, leagueId: 78 }, // Bayer Leverkusen
  27: { apiId: 157, leagueId: 78 }, // Bayern München
  16: { apiId: 165, leagueId: 78 }, // Borussia Dortmund
  18: { apiId: 163, leagueId: 78 }, // Borussia Mönchengladbach
  24: { apiId: 169, leagueId: 78 }, // Eintracht Frankfurt
  167: { apiId: 170, leagueId: 78 }, // FC Augsburg
  35: { apiId: 186, leagueId: 78 }, // FC St. Pauli
  39: { apiId: 164, leagueId: 78 }, // FSV Mainz 05
  41: { apiId: 175, leagueId: 78 }, // Hamburger SV
  23826: { apiId: 173, leagueId: 78 }, // RB Leipzig (ruční)
  60: { apiId: 160, leagueId: 78 }, // SC Freiburg
  89: { apiId: 182, leagueId: 78 }, // Union Berlin
  79: { apiId: 172, leagueId: 78 }, // VfB Stuttgart
  82: { apiId: 161, leagueId: 78 }, // VfL Wolfsburg
  86: { apiId: 162, leagueId: 78 }, // Werder Bremen

  // Serie A (135)
  5: { apiId: 489, leagueId: 135 }, // AC Milan (ruční oprava kolize s Inter)
  800: { apiId: 499, leagueId: 135 }, // Atalanta
  1025: { apiId: 500, leagueId: 135 }, // Bologna
  1390: { apiId: 490, leagueId: 135 }, // Cagliari
  1047: { apiId: 895, leagueId: 135 }, // Como
  2239: { apiId: 520, leagueId: 135 }, // Cremonese
  430: { apiId: 502, leagueId: 135 }, // Fiorentina
  252: { apiId: 495, leagueId: 135 }, // Genoa
  276: { apiId: 504, leagueId: 135 }, // Hellas Verona
  46: { apiId: 505, leagueId: 135 }, // Inter
  506: { apiId: 496, leagueId: 135 }, // Juventus
  398: { apiId: 487, leagueId: 135 }, // Lazio
  1005: { apiId: 867, leagueId: 135 }, // Lecce
  6195: { apiId: 492, leagueId: 135 }, // Napoli
  130: { apiId: 523, leagueId: 135 }, // Parma
  4172: { apiId: 801, leagueId: 135 }, // Pisa
  12: { apiId: 497, leagueId: 135 }, // AS Roma (ruční)
  6574: { apiId: 488, leagueId: 135 }, // Sassuolo
  416: { apiId: 503, leagueId: 135 }, // Torino
  410: { apiId: 494, leagueId: 135 }, // Udinese

  // La Liga (140)
  1108: { apiId: 542, leagueId: 140 }, // Alavés
  621: { apiId: 531, leagueId: 140 }, // Athletic Club
  13: { apiId: 530, leagueId: 140 }, // Atlético Madrid
  131: { apiId: 529, leagueId: 140 }, // Barcelona
  940: { apiId: 538, leagueId: 140 }, // Celta Vigo
  1531: { apiId: 797, leagueId: 140 }, // Elche
  714: { apiId: 540, leagueId: 140 }, // Espanyol
  3709: { apiId: 546, leagueId: 140 }, // Getafe
  12321: { apiId: 547, leagueId: 140 }, // Girona
  3368: { apiId: 539, leagueId: 140 }, // Levante
  237: { apiId: 798, leagueId: 140 }, // Mallorca
  331: { apiId: 727, leagueId: 140 }, // Osasuna
  2497: { apiId: 718, leagueId: 140 }, // Oviedo
  367: { apiId: 728, leagueId: 140 }, // Rayo Vallecano
  150: { apiId: 543, leagueId: 140 }, // Real Betis
  418: { apiId: 541, leagueId: 140 }, // Real Madrid
  681: { apiId: 548, leagueId: 140 }, // Real Sociedad
  368: { apiId: 536, leagueId: 140 }, // Sevilla
  1049: { apiId: 532, leagueId: 140 }, // Valencia
  1050: { apiId: 533, leagueId: 140 }, // Villarreal
};

/** Vyhledání naší klubové identity dle TM club_id (undefined = není to top-5 klub). */
export function lookupTmClub(tmClubId: number | null | undefined): CrosswalkEntry | undefined {
  if (tmClubId == null) return undefined;
  return TM_TO_API[tmClubId];
}
