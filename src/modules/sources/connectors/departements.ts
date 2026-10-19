import { fold } from "@/lib/text";

/** Départements français (code officiel → nom), pour traduire un lieu saisi en clair. */
export const DEPARTEMENTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes", "06": "Alpes-Maritimes",
  "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône",
  "14": "Calvados", "15": "Cantal", "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
  "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
  "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde",
  "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura", "40": "Landes",
  "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
  "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
  "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise", "61": "Orne", "62": "Pas-de-Calais",
  "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin",
  "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn",
  "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges",
  "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne",
  "95": "Val-d'Oise", "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
};

export { fold };

/** Préfecture de chaque département : seule ville reconnue quand une page carrières est filtrée par département. */
export const PREFECTURES: Record<string, string[]> = {
  "01": ["Bourg-en-Bresse"], "02": ["Laon"], "03": ["Moulins"], "04": ["Digne-les-Bains"], "05": ["Gap"], "06": ["Nice"], "07": ["Privas"],
  "08": ["Charleville-Mézières"], "09": ["Foix"], "10": ["Troyes"], "11": ["Carcassonne"], "12": ["Rodez"], "13": ["Marseille"], "14": ["Caen"],
  "15": ["Aurillac"], "16": ["Angoulême"], "17": ["La Rochelle"], "18": ["Bourges"], "19": ["Tulle"], "2A": ["Ajaccio"], "2B": ["Bastia"],
  "21": ["Dijon"], "22": ["Saint-Brieuc"], "23": ["Guéret"], "24": ["Périgueux"], "25": ["Besançon"], "26": ["Valence"], "27": ["Évreux"],
  "28": ["Chartres"], "29": ["Quimper"], "30": ["Nîmes"], "31": ["Toulouse"], "32": ["Auch"], "33": ["Bordeaux"], "34": ["Montpellier"],
  "35": ["Rennes"], "36": ["Châteauroux"], "37": ["Tours"], "38": ["Grenoble"], "39": ["Lons-le-Saunier"], "40": ["Mont-de-Marsan"],
  "41": ["Blois"], "42": ["Saint-Étienne"], "43": ["Le Puy-en-Velay"], "44": ["Nantes"], "45": ["Orléans"], "46": ["Cahors"], "47": ["Agen"],
  "48": ["Mende"], "49": ["Angers"], "50": ["Saint-Lô"], "51": ["Châlons-en-Champagne"], "52": ["Chaumont"], "53": ["Laval"], "54": ["Nancy"],
  "55": ["Bar-le-Duc"], "56": ["Vannes"], "57": ["Metz"], "58": ["Nevers"], "59": ["Lille"], "60": ["Beauvais"], "61": ["Alençon"],
  "62": ["Arras"], "63": ["Clermont-Ferrand"], "64": ["Pau"], "65": ["Tarbes"], "66": ["Perpignan"], "67": ["Strasbourg"], "68": ["Colmar"],
  "69": ["Lyon"], "70": ["Vesoul"], "71": ["Mâcon"], "72": ["Le Mans"], "73": ["Chambéry"], "74": ["Annecy"], "75": ["Paris"], "76": ["Rouen"],
  "77": ["Melun"], "78": ["Versailles"], "79": ["Niort"], "80": ["Amiens"], "81": ["Albi"], "82": ["Montauban"], "83": ["Toulon"],
  "84": ["Avignon"], "85": ["La Roche-sur-Yon"], "86": ["Poitiers"], "87": ["Limoges"], "88": ["Épinal"], "89": ["Auxerre"], "90": ["Belfort"],
  "91": ["Évry-Courcouronnes", "Évry"], "92": ["Nanterre"], "93": ["Bobigny"], "94": ["Créteil"], "95": ["Cergy", "Pontoise"],
  "971": ["Basse-Terre"], "972": ["Fort-de-France"], "973": ["Cayenne"], "974": ["Saint-Denis"], "976": ["Mamoudzou"],
};

/** Département d'un code postal : « 69003 » → « 69 », « 97400 » → « 974 », « 20000 » → « 2A ». */
export function departementOfPostalCode(cp: string): string | null {
  if (!/^\d{5}$/.test(cp)) return null;
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  const code = /^9[78]/.test(cp) ? cp.slice(0, 3) : cp.slice(0, 2);
  return DEPARTEMENTS[code] ? code : null;
}

const BY_NAME = new Map(Object.entries(DEPARTEMENTS).map(([code, name]) => [fold(name), code]));

/** Code de département pour « 69 », « Rhône » ou « rhone » ; null sinon. */
export function departementCode(input: string): string | null {
  const raw = input.trim().toUpperCase();
  if (DEPARTEMENTS[raw]) return raw;
  if (/^\d$/.test(raw) && DEPARTEMENTS[`0${raw}`]) return `0${raw}`;
  return BY_NAME.get(fold(input)) ?? null;
}
