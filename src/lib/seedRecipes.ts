// Cook Notes（実在・実出典）から移植したシードレシピ。
// AIが新レシピを探すまでの「速経路」であり、決定論ランキングの母集団。
// ※ popularity は確認済みの数字のみ記載（不明なものは出典ラベルのみ）。

import type { Recipe } from "./recipe";

export const SEED_RECIPES: Recipe[] = [
  {
    id: "napolitan",
    name: "喫茶店風ナポリタン",
    emoji: "🍝",
    catch: "ケチャップを先に炒めて酸味を飛ばすのが、喫茶店のあの濃厚まろやか味の決め手",
    servings: 1,
    ingredients: [
      { name: "スパゲッティ", amount: "100g（1.8mm）", group: "主材料" },
      { name: "ウインナー", amount: "3本", group: "主材料", toBuy: true },
      { name: "玉ねぎ", amount: "1/4個", group: "主材料", toBuy: true },
      { name: "ピーマン", amount: "1個", group: "主材料", toBuy: true },
      { name: "ケチャップ", amount: "大さじ4", group: "ソース", basicSeasoning: true },
      { name: "バター", amount: "10g", group: "ソース" },
      { name: "砂糖", amount: "ひとつまみ", group: "ソース", basicSeasoning: true },
      { name: "牛乳", amount: "大さじ1", group: "ソース", toBuy: true },
      { name: "塩・こしょう", amount: "少々", group: "ソース", basicSeasoning: true },
    ],
    steps: [
      {
        title: "1. 具材を切る",
        text: "玉ねぎ1/4個は薄切り、ピーマン1個は細切り、ウインナー3本は斜め切り。",
        tip: "玉ねぎは繊維に沿って薄切りにすると食感が残る。",
      },
      {
        title: "2. パスタを少し柔らかめに茹でる",
        text: "塩を入れた湯でスパゲッティ100gを袋表示＋1分茹で、茹で汁を大さじ2取り置く。",
        tip: "ナポリタンはアルデンテより柔らかめが正解。ソースを吸わせる。",
      },
      {
        title: "3. ケチャップを炒めて酸味を飛ばす",
        text: "バター10gで具を炒め、端に寄せてケチャップ大さじ4を1〜2分炒める。色が濃くなったら砂糖ひとつまみを加える。",
        tip: "ここが最大のコツ。先に炒めて水分を飛ばすとコクと甘みが出る。",
      },
      {
        title: "4. 和える",
        text: "茹でたパスタ＋茹で汁大さじ1〜2＋牛乳大さじ1を加えて絡め、塩こしょうで調える。",
        tip: "牛乳で酸味が和らぎまろやかに。無ければバター少し増しでも。",
      },
    ],
    sideDishes: ["コンソメスープ", "千切りキャベツのサラダ"],
    leftoverStorage: [
      { ingredient: "玉ねぎ（残り3/4個）", method: "切り口をラップして野菜室で3〜5日" },
      { ingredient: "ピーマン", method: "ポリ袋で野菜室1週間／種を取り冷凍も可" },
      { ingredient: "ウインナー", method: "密閉袋で冷蔵4〜5日／小分け冷凍3〜4週間" },
      { ingredient: "牛乳（小パック）", method: "開封後は冷蔵3〜4日。早めに消費" },
    ],
    sources: [
      {
        label: "クックパッド殿堂",
        url: "https://cookpad.com/jp/recipes/17679730",
        popularity: "喫茶店の味♡懐かしまろやかナポリタン",
      },
      { label: "白ごはん.com", url: "https://www.sirogohan.com/recipe/naporitan/" },
    ],
    tags: { cuisine: "洋", heaviness: "ガッツリ", staple: "麺", cookTime: 15 },
    createdAt: 0,
  },
  {
    id: "yurinchi",
    name: "油淋鶏（揚げ焼き）",
    emoji: "🍗",
    catch: "揚げずにフライパンで揚げ焼き。カリッと鶏に、ねぎ香味だれをたっぷり",
    servings: 1,
    ingredients: [
      { name: "鶏もも肉", amount: "1枚（250〜350g）", group: "主材料", toBuy: true },
      { name: "片栗粉", amount: "大さじ3", group: "衣" },
      { name: "米油", amount: "底1cm", group: "衣", basicSeasoning: true },
      { name: "長ねぎ", amount: "1/3本", group: "香味だれ", toBuy: true },
      { name: "醤油", amount: "大さじ1.5", group: "香味だれ", basicSeasoning: true },
      { name: "酢", amount: "大さじ1", group: "香味だれ", basicSeasoning: true },
      { name: "砂糖", amount: "大さじ1", group: "香味だれ", basicSeasoning: true },
      { name: "ごま油", amount: "小さじ1", group: "香味だれ", basicSeasoning: true },
      { name: "生姜", amount: "小さじ1", group: "香味だれ" },
    ],
    steps: [
      {
        title: "1. 下処理",
        text: "鶏もも1枚は厚みを開いて均一にし、フォークで穴をあける。醤油・酒・生姜各少々で10分下味。",
        tip: "厚みを揃えると火通りが均一。穴で味が染み焼き縮みも防ぐ。",
      },
      {
        title: "2. 香味だれを作る",
        text: "長ねぎ1/3本をみじん切りにし、醤油大1.5・酢大1・砂糖大1・ごま油小1・生姜小1と混ぜる。",
        tip: "先に作り砂糖を溶かしておくとねぎがなじむ。",
      },
      {
        title: "3. 揚げ焼き",
        text: "片栗粉大さじ3をまぶし、米油底1cmで皮目から4〜5分→返して3〜4分カリッと焼く。",
        tip: "170℃目安。皮目をしっかり焼くとパリッとする。動かさない。",
      },
      {
        title: "4. 仕上げ",
        text: "油を切り2cm幅に切って皿に並べ、香味だれをたっぷりかける。",
        tip: "食べる直前にかけると衣のカリッと感が残る。",
      },
    ],
    sideDishes: ["白ごはん", "中華スープ", "千切りキャベツ"],
    leftoverStorage: [
      { ingredient: "長ねぎ（残り2/3本）", method: "ラップして冷蔵1週間／小口切り冷凍2〜3週間" },
      { ingredient: "鶏もも肉", method: "基本使い切り。余れば下味のまま冷蔵1〜2日" },
      { ingredient: "片栗粉", method: "密閉して常温・長期" },
    ],
    sources: [
      {
        label: "クックパッド殿堂",
        url: "https://cookpad.com/jp/recipes/19099240",
        popularity: "つくれぽ約7,300件",
      },
      { label: "つくおき", url: "https://cookien.com/recipe/49534/" },
    ],
    tags: { cuisine: "中", heaviness: "ガッツリ", staple: "ご飯", cookTime: 30 },
    createdAt: 0,
  },
  {
    id: "acqua-pazza",
    name: "アクアパッツァ",
    emoji: "🐟",
    catch: "魚介の旨みを白ワインと水だけで引き出す、フライパン1つの本格イタリアン",
    servings: 2,
    ingredients: [
      { name: "白身魚の切り身", amount: "2切", group: "主材料", toBuy: true },
      { name: "あさり", amount: "100〜150g", group: "主材料", toBuy: true },
      { name: "ミニトマト", amount: "6〜8個", group: "主材料", toBuy: true },
      { name: "にんにく", amount: "1片", group: "主材料" },
      { name: "オリーブオイル", amount: "大さじ2", group: "煮る", basicSeasoning: true },
      { name: "白ワイン", amount: "50ml", group: "煮る" },
      { name: "水", amount: "150ml", group: "煮る" },
      { name: "塩・こしょう", amount: "少々", group: "煮る", basicSeasoning: true },
    ],
    steps: [
      {
        title: "1. 下準備",
        text: "白身魚2切に塩をして10分→水気を拭く。にんにく1片はみじん切り、ミニトマトは半分に。",
        tip: "塩で身の水分（臭みのもと）を抜く。",
      },
      {
        title: "2. 焼く",
        text: "オリーブオイル大さじ2でにんにくを弱火、魚を皮目から中火で3〜4分動かさず焼く。",
        tip: "動かさず焼くと皮がパリッとする。",
      },
      {
        title: "3. 煮る",
        text: "あさり・ミニトマトを加え、白ワイン50mlを強火で30秒→水150mlを入れ蓋して中火8〜10分。",
        tip: "ブイヨンは入れない。あさりと魚の出汁が主役。",
      },
      {
        title: "4. 乳化・仕上げ",
        text: "蓋を取りオリーブ油大さじ1を足し、揺すって1〜2分乳化。塩こしょうで調える。",
        tip: "あさりの塩分があるので味見してから。",
      },
    ],
    sideDishes: ["バゲット", "白ワイン", "グリーンサラダ"],
    leftoverStorage: [
      { ingredient: "ミニトマト", method: "パック開封後は冷蔵5〜7日" },
      { ingredient: "スープ", method: "翌日まで。魚介の身は当日中に" },
    ],
    sources: [
      { label: "Nadia", url: "https://oceans-nadia.com/user/40170/article/2913" },
      { label: "みんなのきょうの料理（日髙良実）", url: "https://www.kyounoryouri.jp/recipe/602177" },
    ],
    tags: { cuisine: "洋", heaviness: "さっぱり", staple: "パン", cookTime: 30 },
    createdAt: 0,
  },
  {
    id: "shogayaki",
    name: "豚の生姜焼き",
    emoji: "🐖",
    catch: "すりおろし生姜のたれを絡めるだけ。ご飯がすすむ王道おかず",
    servings: 1,
    ingredients: [
      { name: "豚ロース", amount: "150g", group: "主材料", toBuy: true },
      { name: "玉ねぎ", amount: "1/4個", group: "主材料", toBuy: true },
      { name: "生姜", amount: "1かけ", group: "たれ" },
      { name: "醤油", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "みりん", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "料理酒", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "砂糖", amount: "小さじ1", group: "たれ", basicSeasoning: true },
      { name: "サラダ油", amount: "小さじ1", group: "焼く", basicSeasoning: true },
    ],
    steps: [
      {
        title: "1. 下準備",
        text: "玉ねぎ1/4を薄切り、生姜1かけをすりおろす。醤油・みりん・酒各大1＋砂糖小1でたれを作る。",
        tip: "たれを先に合わせておくと焦がさず一気に絡む。",
      },
      {
        title: "2. 焼く",
        text: "サラダ油小1で豚ロース150gを焼き、玉ねぎを加えしんなりするまで炒める。",
        tip: "豚は広げて焼き、色が変わったら触る。",
      },
      {
        title: "3. 絡める",
        text: "たれを回し入れ、強めの中火で照りが出るまで煮絡める。",
        tip: "煮詰めすぎると塩辛くなる。とろみが出たら火を止める。",
      },
    ],
    sideDishes: ["白ごはん", "千切りキャベツ", "味噌汁"],
    leftoverStorage: [
      { ingredient: "玉ねぎ（残り）", method: "切り口ラップで野菜室3〜5日" },
      { ingredient: "豚ロース", method: "使い切り。余れば下味冷凍2〜3週間" },
    ],
    sources: [
      { label: "白ごはん.com", url: "https://www.sirogohan.com/recipe/syougayaki/" },
    ],
    tags: { cuisine: "和", heaviness: "ガッツリ", staple: "ご飯", cookTime: 15 },
    createdAt: 0,
  },
  {
    id: "yamitsuki-chicken-rice",
    name: "やみつき鶏のっけごはん",
    emoji: "🍚",
    catch: "焼いた鶏をご飯にのせ、にんにく醤油だれをかけるだけのスタミナ丼",
    servings: 1,
    ingredients: [
      { name: "鶏もも肉", amount: "1枚（250〜350g）", group: "主材料", toBuy: true },
      { name: "ごはん", amount: "1杯", group: "主材料" },
      { name: "にんにく", amount: "1かけ", group: "たれ" },
      { name: "醤油", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "みりん", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "料理酒", amount: "大さじ1", group: "たれ", basicSeasoning: true },
      { name: "卵黄", amount: "1個", group: "仕上げ" },
    ],
    steps: [
      {
        title: "1. 焼く",
        text: "鶏もも1枚を皮目から焼き、両面こんがり中まで火を通して一口大に切る。",
        tip: "皮目8割・身2割の時間配分でパリッと。",
      },
      {
        title: "2. たれ",
        text: "おろしにんにく1かけ＋醤油・みりん・酒各大1を煮立て、鶏に絡める。",
        tip: "煮詰めて照りを出すと丼映えする。",
      },
      {
        title: "3. 盛る",
        text: "ごはんに鶏をのせ、たれをかけ、卵黄1個を落とす。",
        tip: "卵黄を崩して全体に絡めると一気にコク増し。",
      },
    ],
    sideDishes: ["味噌汁", "浅漬け"],
    leftoverStorage: [
      { ingredient: "鶏もも肉", method: "使い切り。余れば下味冷凍2〜3週間" },
    ],
    sources: [
      { label: "リュウジのバズレシピ", url: "https://bazurecipe.com/" },
    ],
    tags: { cuisine: "和", heaviness: "ガッツリ", staple: "ご飯", cookTime: 15 },
    createdAt: 0,
  },
  {
    id: "tomato-cheese-risotto",
    name: "トマトチーズリゾット",
    emoji: "🧀",
    catch: "炊いたご飯で作る簡単リゾット。トマト缶とチーズで濃厚に",
    servings: 1,
    ingredients: [
      { name: "ごはん", amount: "茶碗1杯", group: "主材料" },
      { name: "トマト缶", amount: "1/2缶", group: "主材料", toBuy: true },
      { name: "玉ねぎ", amount: "1/4個", group: "主材料", toBuy: true },
      { name: "ピザ用チーズ", amount: "30g", group: "主材料", toBuy: true },
      { name: "コンソメ", amount: "小さじ1", group: "味付け", basicSeasoning: true },
      { name: "オリーブオイル", amount: "小さじ1", group: "味付け", basicSeasoning: true },
      { name: "塩・こしょう", amount: "少々", group: "味付け", basicSeasoning: true },
    ],
    steps: [
      {
        title: "1. 炒める",
        text: "オリーブ油小1で玉ねぎ1/4みじん切りを炒める。",
        tip: "透き通るまで弱めの中火で。",
      },
      {
        title: "2. 煮る",
        text: "トマト缶1/2＋水100ml＋コンソメ小1を入れ、ごはん茶碗1杯を加えて2〜3分煮る。",
        tip: "ご飯使用なので煮込みは短時間でOK。",
      },
      {
        title: "3. 仕上げ",
        text: "チーズ30gを加えて溶かし、塩こしょうで調える。",
        tip: "火を止めてからチーズを入れると分離しない。",
      },
    ],
    sideDishes: ["グリーンサラダ", "コンソメスープ"],
    leftoverStorage: [
      { ingredient: "トマト缶（残り1/2）", method: "保存容器に移し冷蔵2〜3日／冷凍も可" },
      { ingredient: "ピザ用チーズ", method: "密閉して冷蔵1週間／冷凍2〜3週間" },
    ],
    sources: [{ label: "Cook Notes（自作）", url: "" }],
    tags: { cuisine: "洋", heaviness: "あっさり", staple: "ご飯", cookTime: 15 },
    createdAt: 0,
  },
];
