/**
 * English display names for cities and countries.
 *
 * Only entries where the English name differs from the native/game name.
 * Cities not listed here use their native name as-is.
 *
 * ATS uses English names natively, so its maps are empty.
 */

import type { GameId } from './game';

// ─── ETS2 City Display Names ────────────────────────────────────────

const ETS2_CITY_DISPLAY_NAMES: Record<string, string> = {
  // Albania
  tirana: 'Tirana',          // Tiranë
  durres: 'Durrës',          // same but normalize
  vlore: 'Vlorë',            // same but normalize

  // Austria
  wien: 'Vienna',            // Wien
  klagenfurt: 'Klagenfurt',  // Klagenfurt am Wörthersee

  // Belgium
  brussel: 'Brussels',       // Brussel
  liege: 'Liège',            // already correct but ensure

  // Bosnia
  banja_luka: 'Banja Luka',       // Бања Лука
  bihac: 'Bihać',                 // Бихаћ
  karakaj: 'Karakaj',             // Каракај
  mostar: 'Mostar',               // Мостар
  sarajevo: 'Sarajevo',           // Сарајево
  tuzla: 'Tuzla',                 // Тузла
  zenica: 'Zenica',               // Зеница

  // Bulgaria
  burgas: 'Burgas',               // Бургас
  karlovo: 'Karlovo',             // Карлово
  kozloduy: 'Kozloduy',           // Козлодуй
  pernik: 'Pernik',               // Перник
  pirdop: 'Pirdop',               // Пирдоп
  pleven: 'Pleven',               // Плевен
  plovdiv: 'Plovdiv',             // Пловдив
  ruse: 'Ruse',                   // Русе
  sofia: 'Sofia',                 // София
  varna: 'Varna',                 // Варна
  veli_tarnovo: 'Veliko Tarnovo', // Велико Търново

  // Czech
  prague: 'Prague',          // Praha

  // Denmark
  kobenhavn: 'Copenhagen',   // København

  // Germany
  dusseldorf: 'Düsseldorf',  // already correct
  frankfurt: 'Frankfurt',    // Frankfurt am Main
  koln: 'Cologne',           // Köln
  munchen: 'Munich',         // München
  nurnberg: 'Nuremberg',     // Nürnberg
  osnabruck: 'Osnabrück',    // already correct
  travemunde: 'Travemünde',  // already correct

  // Greece
  athens: 'Athens',               // Αθήνα
  argostoli: 'Argostoli',         // Αργοστόλι
  chania: 'Chania',               // Χανιά
  chios: 'Chios',                 // Χίος
  heraklion: 'Heraklion',         // Ηράκλειο
  ioannina: 'Ioannina',           // Ιωάννινα
  kalamata: 'Kalamata',           // Καλαμάτα
  kavala: 'Kavala',               // Καβάλα
  lamia: 'Lamia',                 // Λαμία
  larissa: 'Larissa',             // Λάρισα
  mitilini: 'Mytilene',           // Μυτιλήνη
  patras: 'Patras',               // Πάτρα
  rhodes: 'Rhodes',               // Ρόδος
  thessaloniki: 'Thessaloniki',   // Θεσσαλονίκη
  trikala: 'Trikala',             // Τρίκαλα

  // Italy
  firenze: 'Florence',      // Firenze
  genova: 'Genoa',           // Genova
  milano: 'Milan',           // Milano
  napoli: 'Naples',          // Napoli
  roma: 'Rome',              // Roma
  torino: 'Turin',           // Torino
  venezia: 'Venice',         // Venezia
  sangiovanni: 'Villa San Giovanni', // keep consistent

  // North Macedonia
  bitola: 'Bitola',               // Битола
  skopje: 'Skopje',               // Скопје

  // Montenegro
  bijelo_polje: 'Bijelo Polje',   // Бијело Поље
  niksic: 'Nikšić',               // Никшић
  podgorica: 'Podgorica',         // Подгорица

  // Poland
  warszawa: 'Warsaw',       // Warszawa

  // Portugal
  lisboa: 'Lisbon',          // Lisboa

  // Romania
  bucuresti: 'Bucharest',   // București

  // Russia
  kaliningrad: 'Kaliningrad',          // Калининград
  luga: 'Luga',                        // Луга
  petersburg: 'Saint Petersburg',      // Санкт-Петербург
  pskov: 'Pskov',                      // Псков
  sosnovy_bor: 'Sosnovy Bor',          // Сосновый Бор
  vyborg: 'Vyborg',                    // Выборг

  // Serbia
  beograd: 'Belgrade',            // Београд
  kragujevac: 'Kragujevac',       // Крагујевац
  nis: 'Niš',                     // Ниш
  novi_sad: 'Novi Sad',           // Нови Сад

  // Sweden
  goteborg: 'Gothenburg',   // Göteborg

  // Switzerland
  geneve: 'Geneva',          // Genève
  zurich: 'Zurich',          // Zürich
};

// ─── ETS2 Country Display Names ─────────────────────────────────────

const ETS2_COUNTRY_DISPLAY_NAMES: Record<string, string> = {
  albania: 'Albania',            // Shqipëria
  austria: 'Austria',            // Österreich
  belgium: 'Belgium',            // België
  bosnia: 'Bosnia & Herzegovina', // Bosna i Hercegovina
  bulgaria: 'Bulgaria',          // България
  croatia: 'Croatia',            // Hrvatska
  czech: 'Czech Republic',       // Česká republika
  denmark: 'Denmark',            // Danmark
  estonia: 'Estonia',            // Eesti
  finland: 'Finland',            // Suomi
  france: 'France',              // France (same)
  germany: 'Germany',            // Deutschland
  greece: 'Greece',              // Ελληνική Δημοκρατία
  hungary: 'Hungary',            // Magyarország
  iceland: 'Iceland',            // Ísland
  italy: 'Italy',                // Italia
  kosovo: 'Kosovo',              // Kosovo (same)
  latvia: 'Latvia',              // Latvija
  lithuania: 'Lithuania',        // Lietuva
  luxembourg: 'Luxembourg',      // Lëtzebuerg
  macedonia: 'North Macedonia',  // Северна Македонија
  montenegro: 'Montenegro',      // Црна Гора
  netherlands: 'Netherlands',    // Nederland
  norway: 'Norway',              // Norge
  poland: 'Poland',              // Polska
  portugal: 'Portugal',          // Portugal (same)
  romania: 'Romania',            // România
  russia: 'Russia',              // Россия
  serbia: 'Serbia',              // Србија
  slovakia: 'Slovakia',          // Slovensko
  slovenia: 'Slovenia',          // Slovenija
  spain: 'Spain',                // España
  sweden: 'Sweden',              // Sverige
  switzerland: 'Switzerland',    // Schweiz
  turkey: 'Turkey',              // Türkiye
  uk: 'United Kingdom',          // United Kingdom (same)
};

// ─── ATS Display Names (stubs — ATS uses English natively) ──────────

const ATS_CITY_DISPLAY_NAMES: Record<string, string> = {};

const ATS_COUNTRY_DISPLAY_NAMES: Record<string, string> = {
  // ATS uses US states as "countries" — display names if needed
};

// ─── Game-Aware Exports ─────────────────────────────────────────────

const CITY_NAMES: Record<GameId, Record<string, string>> = {
  ets2: ETS2_CITY_DISPLAY_NAMES,
  ats: ATS_CITY_DISPLAY_NAMES,
};

const COUNTRY_NAMES: Record<GameId, Record<string, string>> = {
  ets2: ETS2_COUNTRY_DISPLAY_NAMES,
  ats: ATS_COUNTRY_DISPLAY_NAMES,
};

/** Get city display names for a specific game (or active game). */
export function getCityDisplayNames(gameId: GameId): Record<string, string> {
  return CITY_NAMES[gameId] ?? {};
}

/** Get country display names for a specific game (or active game). */
export function getCountryDisplayNames(gameId: GameId): Record<string, string> {
  return COUNTRY_NAMES[gameId] ?? {};
}

// Backward-compatible direct exports (resolved at import time via active game)
// Used by loader.ts and rankings-view.ts
import { getActiveGame } from './game';

export const CITY_DISPLAY_NAMES = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string) => getCityDisplayNames(getActiveGame())[prop],
  has: (_target, prop: string) => prop in getCityDisplayNames(getActiveGame()),
});

export const COUNTRY_DISPLAY_NAMES = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string) => getCountryDisplayNames(getActiveGame())[prop],
  has: (_target, prop: string) => prop in getCountryDisplayNames(getActiveGame()),
});
