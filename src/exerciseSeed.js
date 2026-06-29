/**
 * Starter exercise library — substantially expanded from the original
 * 47-exercise starter set. Two principles applied throughout:
 *
 * 1. Coverage: significantly more exercises per body part, researched
 *    against common strength-training and bodybuilding references
 *    rather than just the original hand-picked shortlist.
 *
 * 2. Attachment/grip differentiation: cable and machine exercises that
 *    use genuinely different attachments (rope vs. straight bar vs.
 *    V-bar) or grips (wide vs. close vs. neutral) are given SEPARATE
 *    canonical entries, not lumped together as aliases of one generic
 *    exercise. This matters because they train the movement
 *    differently and measurably differ in muscle activation (e.g. a
 *    rope pushdown allows hand separation and a different resistance
 *    curve than a straight-bar pushdown) — merging them into one trend
 *    line would hide which specific variation is actually progressing.
 *    Where the underlying movement is genuinely the same regardless of
 *    minor grip choice, they stay as aliases of one entry instead.
 *
 * `dumbbell_count`: optional. Defaults to 2 (one dumbbell per hand)
 * for any exercise whose `equipment` field contains "Dumbbell" — this
 * is the common case and determines whether logged weight is doubled
 * for volume totals (since the weight you log is what's in ONE hand,
 * not the combined total). Set explicitly to 1 for exercises typically
 * done holding a single weight with both hands (e.g. Russian Twist)
 * where doubling would be wrong.
 */
export const EXERCISE_SEED = [
  // ==================== CHEST ====================
  { canonical_name: 'Barbell Bench Press', body_part: 'Chest', equipment: 'Barbell', aliases: ['bench press', 'bb bench', 'flat bench', 'flat bench press', 'bench'] },
  { canonical_name: 'Incline Barbell Bench Press', body_part: 'Chest', equipment: 'Barbell', aliases: ['incline bench', 'incline bb bench', 'incline press'] },
  { canonical_name: 'Decline Barbell Bench Press', body_part: 'Chest', equipment: 'Barbell', aliases: ['decline bench', 'decline bb bench'] },
  { canonical_name: 'Dumbbell Bench Press', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['db bench', 'dumbbell bench', 'db flat bench'] },
  { canonical_name: 'Incline Dumbbell Press', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['incline db press', 'incline dumbbell bench'] },
  { canonical_name: 'Decline Dumbbell Press', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['decline db press'] },
  { canonical_name: 'Dumbbell Floor Press', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['db floor press', 'floor press'] },
  { canonical_name: 'Machine Chest Press', body_part: 'Chest', equipment: 'Machine', aliases: ['chest press machine', 'seated chest press'] },
  { canonical_name: 'Smith Machine Bench Press', body_part: 'Chest', equipment: 'Smith Machine', aliases: ['smith bench', 'smith machine bench'] },
  { canonical_name: 'Dumbbell Chest Fly', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['dumbbell fly', 'db fly', 'flat dumbbell fly'] },
  { canonical_name: 'Incline Dumbbell Fly', body_part: 'Chest', equipment: 'Dumbbell', aliases: ['incline db fly', 'incline chest fly'] },
  { canonical_name: 'Cable Chest Fly', body_part: 'Chest', equipment: 'Cable', aliases: ['cable fly', 'standing cable fly', 'cable crossover'] },
  { canonical_name: 'Low-to-High Cable Fly', body_part: 'Chest', equipment: 'Cable', aliases: ['low cable fly', 'upward cable fly', 'incline cable fly'] },
  { canonical_name: 'High-to-Low Cable Fly', body_part: 'Chest', equipment: 'Cable', aliases: ['high cable fly', 'downward cable fly', 'decline cable fly'] },
  { canonical_name: 'Pec Deck Machine', body_part: 'Chest', equipment: 'Machine', aliases: ['pec deck', 'machine fly', 'butterfly machine'] },
  { canonical_name: 'Push Up', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['push-up', 'pushup', 'press up'] },
  { canonical_name: 'Incline Push Up', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['incline pushup'] },
  { canonical_name: 'Decline Push Up', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['decline pushup', 'feet elevated push up'] },
  { canonical_name: 'Diamond Push Up', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['diamond pushup', 'close grip push up'] },
  { canonical_name: 'Chest Dip', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['chest dips', 'dip', 'dips'] },
  { canonical_name: 'Weighted Dip', body_part: 'Chest', equipment: 'Bodyweight', aliases: ['weighted dips'] },
  { canonical_name: 'Svend Press', body_part: 'Chest', equipment: 'Plate', dumbbell_count: 1, aliases: ['plate press', 'svend chest press'] },
  { canonical_name: 'Landmine Press', body_part: 'Chest', equipment: 'Barbell', aliases: ['landmine chest press'] },

  // ==================== BACK ====================
  { canonical_name: 'Deadlift', body_part: 'Back', equipment: 'Barbell', aliases: ['conventional deadlift', 'dl', 'bb deadlift'] },
  { canonical_name: 'Romanian Deadlift', body_part: 'Back', equipment: 'Barbell', aliases: ['rdl', 'romanian deadlifts', 'stiff leg deadlift'] },
  { canonical_name: 'Sumo Deadlift', body_part: 'Back', equipment: 'Barbell', aliases: ['sumo dl', 'sumo pull'] },
  { canonical_name: 'Deficit Deadlift', body_part: 'Back', equipment: 'Barbell', aliases: ['deficit dl'] },
  { canonical_name: 'Trap Bar Deadlift', body_part: 'Back', equipment: 'Trap Bar', aliases: ['hex bar deadlift', 'trap bar dl'] },
  { canonical_name: 'Rack Pull', body_part: 'Back', equipment: 'Barbell', aliases: ['rack pulls', 'partial deadlift'] },
  { canonical_name: 'Pull Up', body_part: 'Back', equipment: 'Bodyweight', aliases: ['pull-up', 'pullup', 'pull ups'] },
  { canonical_name: 'Chin Up', body_part: 'Back', equipment: 'Bodyweight', aliases: ['chin-up', 'chinup', 'chin ups'] },
  { canonical_name: 'Neutral Grip Pull Up', body_part: 'Back', equipment: 'Bodyweight', aliases: ['neutral grip pullup', 'hammer grip pull up'] },
  { canonical_name: 'Weighted Pull Up', body_part: 'Back', equipment: 'Bodyweight', aliases: ['weighted pullups'] },
  { canonical_name: 'Assisted Pull Up', body_part: 'Back', equipment: 'Machine', aliases: ['assisted pullup machine', 'pull up assist machine'] },
  { canonical_name: 'Wide Grip Lat Pulldown', body_part: 'Back', equipment: 'Cable', aliases: ['wide grip pulldown', 'lat pulldown', 'pulldown', 'cable pulldown'] },
  { canonical_name: 'Close Grip Lat Pulldown', body_part: 'Back', equipment: 'Cable', aliases: ['close grip pulldown', 'v-bar pulldown', 'narrow grip pulldown'] },
  { canonical_name: 'Neutral Grip Lat Pulldown', body_part: 'Back', equipment: 'Cable', aliases: ['neutral grip pulldown', 'mag grip pulldown'] },
  { canonical_name: 'Reverse Grip Lat Pulldown', body_part: 'Back', equipment: 'Cable', aliases: ['underhand pulldown', 'supinated pulldown', 'reverse pulldown'] },
  { canonical_name: 'Single Arm Lat Pulldown', body_part: 'Back', equipment: 'Cable', dumbbell_count: 1, aliases: ['one arm pulldown', 'unilateral pulldown'] },
  { canonical_name: 'Straight Arm Pulldown', body_part: 'Back', equipment: 'Cable', aliases: ['straight arm pull down', 'lat pushdown'] },
  { canonical_name: 'Barbell Row', body_part: 'Back', equipment: 'Barbell', aliases: ['bent over row', 'bb row', 'barbell bent over row'] },
  { canonical_name: 'Pendlay Row', body_part: 'Back', equipment: 'Barbell', aliases: ['pendlay rows', 'dead stop row'] },
  { canonical_name: 'Yates Row', body_part: 'Back', equipment: 'Barbell', aliases: ['underhand barbell row'] },
  { canonical_name: 'Dumbbell Row', body_part: 'Back', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['db row', 'one arm row', 'single arm row'] },
  { canonical_name: 'Chest Supported Dumbbell Row', body_part: 'Back', equipment: 'Dumbbell', aliases: ['chest supported row', 'incline bench row'] },
  { canonical_name: 'Seated Cable Row — Wide Grip', body_part: 'Back', equipment: 'Cable', aliases: ['wide grip cable row', 'wide cable row'] },
  { canonical_name: 'Seated Cable Row — V-Bar', body_part: 'Back', equipment: 'Cable', aliases: ['cable row', 'seated row', 'v-bar row', 'close grip cable row'] },
  { canonical_name: 'Seated Cable Row — Rope', body_part: 'Back', equipment: 'Cable', aliases: ['rope row', 'rope cable row'] },
  { canonical_name: 'T-Bar Row', body_part: 'Back', equipment: 'Barbell', aliases: ['tbar row', 't bar row'] },
  { canonical_name: 'Meadows Row', body_part: 'Back', equipment: 'Barbell', dumbbell_count: 1, aliases: ['landmine row', 'meadows rows'] },
  { canonical_name: 'Machine Row', body_part: 'Back', equipment: 'Machine', aliases: ['seated row machine', 'hammer strength row'] },
  { canonical_name: 'Inverted Row', body_part: 'Back', equipment: 'Bodyweight', aliases: ['bodyweight row', 'bar row'] },
  { canonical_name: 'Good Morning', body_part: 'Back', equipment: 'Barbell', aliases: ['good mornings', 'barbell good morning'] },
  { canonical_name: 'Back Extension', body_part: 'Back', equipment: 'Bodyweight', aliases: ['hyperextension', 'hyperextensions', 'roman chair'] },
  { canonical_name: 'Shrug', body_part: 'Back', equipment: 'Barbell', aliases: ['barbell shrug', 'shrugs', 'trap shrug'] },
  { canonical_name: 'Dumbbell Shrug', body_part: 'Back', equipment: 'Dumbbell', aliases: ['db shrug', 'dumbbell shrugs'] },

  // ==================== LEGS ====================
  { canonical_name: 'Back Squat', body_part: 'Legs', equipment: 'Barbell', aliases: ['squat', 'bb squat', 'barbell squat', 'high bar squat'] },
  { canonical_name: 'Low Bar Squat', body_part: 'Legs', equipment: 'Barbell', aliases: ['low bar back squat', 'powerlifting squat'] },
  { canonical_name: 'Front Squat', body_part: 'Legs', equipment: 'Barbell', aliases: ['front squats'] },
  { canonical_name: 'Box Squat', body_part: 'Legs', equipment: 'Barbell', aliases: ['box squats'] },
  { canonical_name: 'Goblet Squat', body_part: 'Legs', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['goblet squats', 'kettlebell goblet squat'] },
  { canonical_name: 'Hack Squat', body_part: 'Legs', equipment: 'Machine', aliases: ['hack squat machine'] },
  { canonical_name: 'Smith Machine Squat', body_part: 'Legs', equipment: 'Smith Machine', aliases: ['smith squat'] },
  { canonical_name: 'Leg Press', body_part: 'Legs', equipment: 'Machine', aliases: ['leg press machine'] },
  { canonical_name: 'Single Leg Press', body_part: 'Legs', equipment: 'Machine', aliases: ['one leg press', 'unilateral leg press'] },
  { canonical_name: 'Leg Extension', body_part: 'Legs', equipment: 'Machine', aliases: ['quad extension', 'leg extensions'] },
  { canonical_name: 'Single Leg Extension', body_part: 'Legs', equipment: 'Machine', aliases: ['one leg extension', 'unilateral leg extension'] },
  { canonical_name: 'Lying Leg Curl', body_part: 'Legs', equipment: 'Machine', aliases: ['lying hamstring curl', 'prone leg curl'] },
  { canonical_name: 'Seated Leg Curl', body_part: 'Legs', equipment: 'Machine', aliases: ['seated hamstring curl'] },
  { canonical_name: 'Standing Leg Curl', body_part: 'Legs', equipment: 'Machine', aliases: ['standing hamstring curl'] },
  { canonical_name: 'Nordic Hamstring Curl', body_part: 'Legs', equipment: 'Bodyweight', aliases: ['nordic curl', 'nordic curls'] },
  { canonical_name: 'Bulgarian Split Squat', body_part: 'Legs', equipment: 'Dumbbell', aliases: ['bss', 'split squat', 'rear foot elevated split squat'] },
  { canonical_name: 'Barbell Bulgarian Split Squat', body_part: 'Legs', equipment: 'Barbell', aliases: ['barbell bss', 'barbell split squat'] },
  { canonical_name: 'Walking Lunge', body_part: 'Legs', equipment: 'Dumbbell/Bodyweight', aliases: ['lunges', 'lunge', 'walking lunges'] },
  { canonical_name: 'Reverse Lunge', body_part: 'Legs', equipment: 'Dumbbell/Bodyweight', aliases: ['reverse lunges', 'backward lunge'] },
  { canonical_name: 'Barbell Lunge', body_part: 'Legs', equipment: 'Barbell', aliases: ['barbell lunges'] },
  { canonical_name: 'Step Up', body_part: 'Legs', equipment: 'Dumbbell/Bodyweight', aliases: ['step ups', 'box step up'] },
  { canonical_name: 'Hip Thrust', body_part: 'Legs', equipment: 'Barbell', aliases: ['barbell hip thrust', 'hip thrusts'] },
  { canonical_name: 'Glute Bridge', body_part: 'Legs', equipment: 'Bodyweight', aliases: ['glute bridges', 'bodyweight hip thrust'] },
  { canonical_name: 'Cable Kickback', body_part: 'Legs', equipment: 'Cable', aliases: ['cable glute kickback', 'glute kickback'] },
  { canonical_name: 'Hip Abduction Machine', body_part: 'Legs', equipment: 'Machine', aliases: ['hip abductor', 'abductor machine'] },
  { canonical_name: 'Hip Adduction Machine', body_part: 'Legs', equipment: 'Machine', aliases: ['hip adductor', 'adductor machine'] },
  { canonical_name: 'Standing Calf Raise', body_part: 'Legs', equipment: 'Machine/Bodyweight', aliases: ['calf raise', 'calf raises'] },
  { canonical_name: 'Seated Calf Raise', body_part: 'Legs', equipment: 'Machine', aliases: ['seated calf raises'] },
  { canonical_name: 'Leg Press Calf Raise', body_part: 'Legs', equipment: 'Machine', aliases: ['calf press'] },
  { canonical_name: 'Pistol Squat', body_part: 'Legs', equipment: 'Bodyweight', aliases: ['pistol squats', 'single leg squat'] },
  { canonical_name: 'Sissy Squat', body_part: 'Legs', equipment: 'Bodyweight', aliases: ['sissy squats'] },

  // ==================== SHOULDERS ====================
  { canonical_name: 'Overhead Press', body_part: 'Shoulders', equipment: 'Barbell', aliases: ['ohp', 'military press', 'shoulder press', 'standing press'] },
  { canonical_name: 'Push Press', body_part: 'Shoulders', equipment: 'Barbell', aliases: ['push presses'] },
  { canonical_name: 'Seated Barbell Shoulder Press', body_part: 'Shoulders', equipment: 'Barbell', aliases: ['seated military press', 'seated ohp'] },
  { canonical_name: 'Dumbbell Shoulder Press', body_part: 'Shoulders', equipment: 'Dumbbell', aliases: ['db shoulder press', 'seated db press'] },
  { canonical_name: 'Arnold Press', body_part: 'Shoulders', equipment: 'Dumbbell', aliases: ['arnold presses'] },
  { canonical_name: 'Machine Shoulder Press', body_part: 'Shoulders', equipment: 'Machine', aliases: ['shoulder press machine'] },
  { canonical_name: 'Smith Machine Shoulder Press', body_part: 'Shoulders', equipment: 'Smith Machine', aliases: ['smith shoulder press'] },
  { canonical_name: 'Dumbbell Lateral Raise', body_part: 'Shoulders', equipment: 'Dumbbell', aliases: ['lateral raise', 'side raise', 'db lateral raise', 'lat raise'] },
  { canonical_name: 'Cable Lateral Raise', body_part: 'Shoulders', equipment: 'Cable', dumbbell_count: 1, aliases: ['cable side raise'] },
  { canonical_name: 'Machine Lateral Raise', body_part: 'Shoulders', equipment: 'Machine', aliases: ['lateral raise machine'] },
  { canonical_name: 'Leaning Lateral Raise', body_part: 'Shoulders', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['leaning cable lateral raise'] },
  { canonical_name: 'Front Raise', body_part: 'Shoulders', equipment: 'Dumbbell', aliases: ['front delt raise', 'dumbbell front raise'] },
  { canonical_name: 'Plate Front Raise', body_part: 'Shoulders', equipment: 'Plate', dumbbell_count: 1, aliases: ['plate raise'] },
  { canonical_name: 'Cable Front Raise', body_part: 'Shoulders', equipment: 'Cable', dumbbell_count: 1, aliases: ['cable front delt raise'] },
  { canonical_name: 'Dumbbell Rear Delt Fly', body_part: 'Shoulders', equipment: 'Dumbbell', aliases: ['reverse fly', 'rear delt flye', 'bent over lateral raise', 'rear delt fly'] },
  { canonical_name: 'Cable Rear Delt Fly', body_part: 'Shoulders', equipment: 'Cable', aliases: ['cable reverse fly', 'cross cable rear delt'] },
  { canonical_name: 'Reverse Pec Deck', body_part: 'Shoulders', equipment: 'Machine', aliases: ['rear delt machine', 'reverse fly machine'] },
  { canonical_name: 'Face Pull — Rope', body_part: 'Shoulders', equipment: 'Cable', aliases: ['face pull', 'face pulls', 'rope face pull'] },
  { canonical_name: 'Upright Row', body_part: 'Shoulders', equipment: 'Barbell', aliases: ['barbell upright row', 'upright rows'] },
  { canonical_name: 'Cable Upright Row', body_part: 'Shoulders', equipment: 'Cable', aliases: ['cable upright rows'] },
  { canonical_name: 'Shoulder External Rotation', body_part: 'Shoulders', equipment: 'Cable', dumbbell_count: 1, aliases: ['cable external rotation', 'rotator cuff external'] },
  { canonical_name: 'Shoulder Internal Rotation', body_part: 'Shoulders', equipment: 'Cable', dumbbell_count: 1, aliases: ['cable internal rotation', 'rotator cuff internal'] },

  // ==================== ARMS — BICEPS ====================
  { canonical_name: 'Barbell Curl', body_part: 'Arms', equipment: 'Barbell', aliases: ['bicep curl', 'bb curl', 'standing curl'] },
  { canonical_name: 'EZ-Bar Curl', body_part: 'Arms', equipment: 'EZ-Bar', aliases: ['ez bar curl', 'ez curl bar bicep curl'] },
  { canonical_name: 'Dumbbell Curl', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['db curl', 'alternating curl', 'alternating dumbbell curl'] },
  { canonical_name: 'Seated Dumbbell Curl', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['seated db curl'] },
  { canonical_name: 'Incline Dumbbell Curl', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['incline db curl'] },
  { canonical_name: 'Hammer Curl', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['hammer curls'] },
  { canonical_name: 'Cross-Body Hammer Curl', body_part: 'Arms', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['cross body hammer curl'] },
  { canonical_name: 'Preacher Curl — Barbell', body_part: 'Arms', equipment: 'Barbell', aliases: ['preacher curl', 'barbell preacher curl'] },
  { canonical_name: 'Preacher Curl — Dumbbell', body_part: 'Arms', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['db preacher curl', 'single arm preacher curl'] },
  { canonical_name: 'Preacher Curl — Machine', body_part: 'Arms', equipment: 'Machine', aliases: ['machine preacher curl', 'preacher curl machine'] },
  { canonical_name: 'Cable Curl — Straight Bar', body_part: 'Arms', equipment: 'Cable', aliases: ['cable curl', 'straight bar cable curl'] },
  { canonical_name: 'Cable Curl — Rope', body_part: 'Arms', equipment: 'Cable', aliases: ['rope cable curl', 'rope hammer curl'] },
  { canonical_name: 'Cable Curl — EZ Bar', body_part: 'Arms', equipment: 'Cable', aliases: ['ez bar cable curl'] },
  { canonical_name: 'Spider Curl', body_part: 'Arms', equipment: 'Dumbbell/EZ-Bar', aliases: ['spider curls'] },
  { canonical_name: 'Concentration Curl', body_part: 'Arms', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['concentration curls'] },
  { canonical_name: 'Drag Curl', body_part: 'Arms', equipment: 'Barbell', aliases: ['drag curls', 'barbell drag curl'] },
  { canonical_name: 'Reverse Curl', body_part: 'Arms', equipment: 'Barbell/EZ-Bar', aliases: ['reverse grip curl', 'overhand curl'] },
  { canonical_name: 'Zottman Curl', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['zottman curls'] },

  // ==================== ARMS — TRICEPS (attachment-differentiated) ====================
  { canonical_name: 'Tricep Pushdown — Straight Bar', body_part: 'Arms', equipment: 'Cable', aliases: ['straight bar pushdown', 'tricep pushdown', 'cable pushdown'] },
  { canonical_name: 'Tricep Pushdown — Rope', body_part: 'Arms', equipment: 'Cable', aliases: ['rope pushdown', 'rope tricep pushdown', 'rope tricep extension'] },
  { canonical_name: 'Tricep Pushdown — V-Bar', body_part: 'Arms', equipment: 'Cable', aliases: ['v-bar pushdown', 'v bar tricep pushdown'] },
  { canonical_name: 'Tricep Pushdown — Reverse Grip', body_part: 'Arms', equipment: 'Cable', aliases: ['reverse grip pushdown', 'underhand pushdown', 'underhand tricep pushdown'] },
  { canonical_name: 'Single Arm Tricep Pushdown', body_part: 'Arms', equipment: 'Cable', dumbbell_count: 1, aliases: ['one arm pushdown', 'single arm cable pushdown'] },
  { canonical_name: 'Overhead Cable Tricep Extension — Rope', body_part: 'Arms', equipment: 'Cable', aliases: ['overhead rope extension', 'overhead tricep extension'] },
  { canonical_name: 'Skull Crusher — Barbell', body_part: 'Arms', equipment: 'Barbell', aliases: ['skullcrusher', 'skull crushers', 'lying tricep extension', 'barbell skull crusher'] },
  { canonical_name: 'Skull Crusher — EZ-Bar', body_part: 'Arms', equipment: 'EZ-Bar', aliases: ['ez bar skull crusher', 'ez skullcrusher'] },
  { canonical_name: 'Skull Crusher — Dumbbell', body_part: 'Arms', equipment: 'Dumbbell', aliases: ['db skullcrusher', 'dumbbell lying tricep extension'] },
  { canonical_name: 'Close Grip Bench Press', body_part: 'Arms', equipment: 'Barbell', aliases: ['cgbp', 'close grip bench'] },
  { canonical_name: 'Dumbbell Overhead Tricep Extension', body_part: 'Arms', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['overhead db extension', 'french press'] },
  { canonical_name: 'Tricep Kickback', body_part: 'Arms', equipment: 'Dumbbell', dumbbell_count: 1, aliases: ['dumbbell kickback', 'tricep kickbacks'] },
  { canonical_name: 'Tricep Dip Machine', body_part: 'Arms', equipment: 'Machine', aliases: ['machine tricep dip', 'assisted dip machine tricep'] },

  // ==================== ARMS — FOREARMS ====================
  { canonical_name: 'Wrist Curl', body_part: 'Arms', equipment: 'Barbell/Dumbbell', aliases: ['wrist curls', 'barbell wrist curl'] },
  { canonical_name: 'Reverse Wrist Curl', body_part: 'Arms', equipment: 'Barbell/Dumbbell', aliases: ['reverse wrist curls', 'wrist extension'] },
  { canonical_name: 'Farmers Carry', body_part: 'Arms', equipment: 'Dumbbell', aliases: ["farmer's walk", 'farmers walk', 'loaded carry'] },

  // ==================== CORE ====================
  { canonical_name: 'Plank', body_part: 'Core', equipment: 'Bodyweight', aliases: ['planks'] },
  { canonical_name: 'Side Plank', body_part: 'Core', equipment: 'Bodyweight', aliases: ['side planks'] },
  { canonical_name: 'Hanging Leg Raise', body_part: 'Core', equipment: 'Bodyweight', aliases: ['leg raises', 'hanging knee raise'] },
  { canonical_name: 'Lying Leg Raise', body_part: 'Core', equipment: 'Bodyweight', aliases: ['flat leg raise', 'floor leg raise'] },
  { canonical_name: 'Cable Crunch', body_part: 'Core', equipment: 'Cable', aliases: ['kneeling cable crunch'] },
  { canonical_name: 'Machine Crunch', body_part: 'Core', equipment: 'Machine', aliases: ['ab crunch machine', 'crunch machine'] },
  { canonical_name: 'Russian Twist', body_part: 'Core', equipment: 'Bodyweight/Dumbbell', dumbbell_count: 1, aliases: ['russian twists'] },
  { canonical_name: 'Ab Wheel Rollout', body_part: 'Core', equipment: 'Ab Wheel', aliases: ['ab wheel', 'ab rollout'] },
  { canonical_name: 'Sit Up', body_part: 'Core', equipment: 'Bodyweight', aliases: ['sit-up', 'situp', 'sit ups'] },
  { canonical_name: 'Weighted Sit Up', body_part: 'Core', equipment: 'Plate', dumbbell_count: 1, aliases: ['weighted situp'] },
  { canonical_name: 'V-Up', body_part: 'Core', equipment: 'Bodyweight', aliases: ['v-ups', 'v sit'] },
  { canonical_name: 'Mountain Climber', body_part: 'Core', equipment: 'Bodyweight', aliases: ['mountain climbers'] },
  { canonical_name: 'Dead Bug', body_part: 'Core', equipment: 'Bodyweight', aliases: ['dead bugs'] },
  { canonical_name: 'Woodchopper — Cable', body_part: 'Core', equipment: 'Cable', aliases: ['cable woodchopper', 'wood chop', 'cable woodchop'] },

  // ==================== CARDIO ====================
  { canonical_name: 'Running', body_part: 'Cardio', equipment: 'None', aliases: ['run', 'jog', 'jogging'] },
  { canonical_name: 'Sprinting', body_part: 'Cardio', equipment: 'None', aliases: ['sprints', 'sprint'] },
  { canonical_name: 'Treadmill Running', body_part: 'Cardio', equipment: 'Machine', aliases: ['treadmill run', 'treadmill'] },
  { canonical_name: 'Cycling', body_part: 'Cardio', equipment: 'Bike', aliases: ['bike', 'biking', 'cycle', 'stationary bike', 'spin', 'spinning'] },
  { canonical_name: 'Rowing', body_part: 'Cardio', equipment: 'Rower', aliases: ['row', 'rowing machine', 'erg'] },
  { canonical_name: 'Swimming', body_part: 'Cardio', equipment: 'None', aliases: ['swim', 'pool laps', 'laps'] },
  { canonical_name: 'Elliptical', body_part: 'Cardio', equipment: 'Machine', aliases: ['cross trainer', 'elliptical machine'] },
  { canonical_name: 'Stair Climber', body_part: 'Cardio', equipment: 'Machine', aliases: ['stairmaster', 'stair master', 'stepper'] },
  { canonical_name: 'Walking', body_part: 'Cardio', equipment: 'None', aliases: ['walk', 'treadmill walk'] },
  { canonical_name: 'Incline Walking', body_part: 'Cardio', equipment: 'Machine', aliases: ['incline treadmill walk', 'incline walk'] },
  { canonical_name: 'Jump Rope', body_part: 'Cardio', equipment: 'Jump Rope', aliases: ['skipping', 'skipping rope'] },
  { canonical_name: 'Assault Bike', body_part: 'Cardio', equipment: 'Bike', aliases: ['air bike', 'fan bike'] },
  { canonical_name: 'Ski Erg', body_part: 'Cardio', equipment: 'Machine', aliases: ['ski erg machine', 'skierg'] },
];
