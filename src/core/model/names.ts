/**
 * ======================================================================
 *  names.ts  人材名生成データ（name_generator.py の TS 移植）
 * ----------------------------------------------------------------------
 *  出典: 開発チーム『name_generator.py』(試作v0.1) の NAME_DB をそのまま移植。
 *  FM方式：主要国の頻出名（姓・名を性別別）を組み合わせて氏名を生成する。
 *  プロトタイプではプレイ可能5か国（JP/US/GB/DE/SG）に名前セットを割り当てる。
 * ======================================================================
 */

import type { PRNG } from "../prng";
import type { PlayableCountry, Sex } from "./types";

/** 1国分の名前セット。 */
interface NameSet {
  male: string[];
  female: string[];
  surname: string[];
}

/** name_generator.py の NAME_DB（主要国分を移植）。 */
export const NAME_DB: Record<string, NameSet> = {
  Japan: {
    male: ["Haruto", "Yuto", "Sota", "Yuki", "Hayato", "Ren", "Riku", "Sho", "Kaito", "Daiki"],
    female: ["Yui", "Aoi", "Hina", "Sakura", "Mei", "Rin", "Yuna", "Akari", "Miku", "Saki"],
    surname: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato"],
  },
  USA: {
    male: ["Liam", "Noah", "Oliver", "James", "Elijah", "William", "Henry", "Lucas", "Benjamin", "Mason"],
    female: ["Olivia", "Emma", "Charlotte", "Amelia", "Sophia", "Isabella", "Ava", "Mia", "Evelyn", "Luna"],
    surname: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Anderson"],
  },
  England: {
    male: ["Oliver", "George", "Harry", "Jack", "Charlie", "Thomas", "Oscar", "William", "Henry", "Jacob"],
    female: ["Olivia", "Amelia", "Isla", "Ava", "Emily", "Grace", "Sophie", "Lily", "Freya", "Ella"],
    surname: ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Robinson", "Wright"],
  },
  Germany: {
    male: ["Ben", "Paul", "Leon", "Finn", "Elias", "Jonas", "Luka", "Felix", "Noah", "Maximilian"],
    female: ["Emma", "Mia", "Hannah", "Emilia", "Sofia", "Lina", "Marie", "Lena", "Clara", "Anna"],
    surname: ["Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann"],
  },
  China: {
    male: ["Wei", "Hao", "Jun", "Lei", "Ming", "Yang", "Bo", "Feng", "Tao", "Chen"],
    female: ["Fang", "Li", "Xiu", "Yan", "Na", "Jing", "Min", "Hui", "Ping", "Mei"],
    surname: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou"],
  },
  India: {
    male: ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan"],
    female: ["Saanvi", "Aanya", "Aadhya", "Ananya", "Diya", "Pari", "Anika", "Navya", "Riya", "Ira"],
    surname: ["Sharma", "Verma", "Patel", "Singh", "Kumar", "Gupta", "Reddy", "Nair", "Rao", "Chauhan"],
  },
};

/**
 * プレイ可能国 → 使用する名前セットのキー群。
 * シンガポール(SG)は多文化なので複数セットをブレンドする（華人/インド系/英語圏）。
 */
const COUNTRY_NAME_KEYS: Record<PlayableCountry, string[]> = {
  JP: ["Japan"],
  US: ["USA"],
  GB: ["England"],
  DE: ["Germany"],
  SG: ["China", "India", "England"], // 多文化ハブを表現
};

/** 指定国・性別の氏名を1つ生成する。 */
export function generateName(country: PlayableCountry, sex: Sex, rng: PRNG): string {
  const keys = COUNTRY_NAME_KEYS[country];
  const key = keys[rng.int(0, keys.length - 1)];
  const set = NAME_DB[key];
  const firstList = sex === "male" ? set.male : set.female;
  const first = firstList[rng.int(0, firstList.length - 1)];
  const last = set.surname[rng.int(0, set.surname.length - 1)];
  return `${first} ${last}`;
}
