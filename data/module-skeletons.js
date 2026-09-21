/* 模块/事件插入时的默认 objdata 骨架 —— 由 Z-Editor 的 ModuleDefinitions.kt 提取。
 * 自动生成后再人工核对，不是手工维护的数据文件。
 * 每个 objClass 对应插入时新对象 objdata 的初始值（Gson 全默认序列化的结果，null 字段已省略）。
 *
 * 提取规则：
 *   - 键名取自 PvzDataModels.kt 的 @SerializedName，没有该注解时用 Kotlin 属性名。
 *   - 默认值为 null 的字段整体省略（Gson 默认不序列化 null，这与 Z-Editor 的实际行为一致）。
 *   - 默认值为另一个 data class 实例时递归展开；空类（class X，无字段）展开为 {}。
 *   - @JsonAdapter(FlexibleIntAdapter::class) 标注的 Int 字段序列化成字符串（如 "5"）。
 *   - 只收录 initialDataFactory 非 null 的条目；工厂为 null 的模块不会创建对象，
 *     只在 Modules 数组里加一个 RTID 引用，因此本表里没有它们（见文件末尾注释）。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Skeletons = {
  // ===================== ModuleRegistry（52 条） =====================
  "WaveManagerModuleProperties": {
    "DynamicZombies": [
      {
        "PointIncrementPerWave": 0,
        "StartingPoints": 0,
        "StartingWave": 0,
        "ZombiePool": [],
        "ZombieLevel": []
      }
    ],
    "WaveManagerProps": "RTID(WaveManagerProps@CurrentLevel)"
  },
  "SeedBankProperties": {
    "PresetPlantList": [],
    "PlantWhiteList": [],
    "PlantBlackList": [],
    "SelectionMethod": "chooser",
    "OverrideSeedSlotsCount": 8
  },
  "ConveyorSeedBankProperties": {
    "InitialPlantList": [],
    "DropDelayConditions": [],
    "SpeedConditions": []
  },
  "PennyClassroomModuleProperties": {
    "PlantMap": {}
  },
  "LevelMutatorMaxSunProps": {
    "MaxSunOverride": 9900,
    "DifficultyProps": "RTID(LevelModuleDifficultyMaxSun@LevelModulesDifficulty)",
    "IconImage": "IMAGE_UI_PENNY_PURSUITS_DIFFICULTY_MODIFIER_ICONS_DIFFICULTY_MODIFIER_STARTING_SUN",
    "IconText": ""
  },
  "LevelMutatorStartingPlantfoodProps": {
    "StartingPlantfoodOverride": 0,
    "DifficultyProps": "RTID(LevelModuleDifficultyStartingPlantfood@LevelModulesDifficulty)",
    "IconImage": "IMAGE_UI_PENNY_PURSUITS_DIFFICULTY_MODIFIER_ICONS_DIFFICULTY_MODIFIER_PF",
    "IconText": ""
  },
  "StarChallengeModuleProperties": {
    "ChallengesAlwaysAvailable": true,
    "Challenges": []
  },
  "LevelScoringModuleProperties": {
    "PlantBonusMultiplier": 0.0,
    "PlantBonuses": [],
    "ScoringRulesType": "NoMultiplier",
    "StartingPlantfood": 0
  },
  // 空类 class SouDaCheDamageTextModuleData，无字段
  "SouDaCheDamageTextModuleProperties": {},
  "IncreasedCostModuleProperties": {
    "BaseCostIncreased": 25,
    "MaxIncreasedCount": 10
  },
  "DeathHoleModuleProperties": {
    "LifeTime": 10
  },
  "ZombieMoveFastModuleProperties": {
    "StopColumn": 6,
    "SpeedUp": 3.0
  },
  "PickupCollectableTutorialProperties": {
    "DropperZombieType": "mummy",
    "LootType": "GoldCoin",
    "PostPickupAdvice": "",
    "PickupAdvice": ""
  },
  "LevelMutatorRiftTimedSunProps": {
    "DifficultyProps": "RTID(LevelModuleDifficultyRiftTimedSun@LevelModulesDifficulty)",
    "IconImage": "IMAGE_UI_PENNY_PURSUITS_DIFFICULTY_MODIFIER_ICONS_DIFFICULTY_MODIFIER_NO_SUN_DROP",
    "IconText": "",
    "SunDrops": [],
    "InvalidPlantTypes": []
  },
  "RiftThemeDemoModuleProperties": {
    "DemoRiftThemeName": []
  },
  "BowlingMinigameProperties": {
    "BowlingFoulLine": 2
  },
  // 空类 class NewBowlingMinigamePropertiesData，无字段
  "NewBowlingMinigameProperties": {},
  "VaseBreakerPresetProperties": {
    "MinColumnIndex": 4,
    "MaxColumnIndex": 8,
    "NumColoredPlantVases": 0,
    "NumColoredZombieVases": 0,
    "GridSquareBlacklist": [],
    "Vases": []
  },
  // 空类 class VaseBreakerArcadeModuleData，无字段
  "VaseBreakerArcadeModuleProperties": {},
  // 空类 class VaseBreakerFlowModuleData，无字段
  "VaseBreakerFlowModuleProperties": {},
  "EvilDaveProperties": {
    "PlantDistance": 4
  },
  "ZombossBattleModuleProperties": {
    "ReservedColumnCount": 2,
    "ZombossMechType": "zombossmech_egypt",
    "ZombossStageCount": 3,
    "ZombossDeathRow": 3,
    "ZombossDeathColumn": 5,
    "ZombossSpawnGridPosition": {
      "mX": 6,
      "mY": 3
    }
  },
  "ZombossBattleIntroProperties": {
    "PanStartOffset": 78,
    "PanEndOffset": 486,
    "PanRightDuration": 1.5,
    "PanLeftDuration": 1.5,
    "ZombossPhaseCount": 3,
    "SkipShowingStreetBossBattle": false
  },
  "SingleHandedProperties": {
    "ResourceGroupNames": [
      "SingleHandedGroup"
    ],
    "InitWeapon": "peashooter",
    "InitWeaponLaunchTimePercent": 1.0,
    "MissileCount": 1,
    "MissileInterval": 30,
    "RocketHitTime": 6,
    "RocketSpeed": 500,
    "TimeSpeed": 1.5,
    "ZombiesWalkSpeed": 1.0,
    "ZombiesHitpointsPercent": 0.1,
    "DropWeaponDatas": [],
    "SpecialWaveDatas": []
  },
  "SeedRainProperties": {
    "RainInterval": 5,
    "SeedRains": []
  },
  "LastStandMinigameProperties": {
    "StartingSun": 2000,
    "StartingPlantfood": 0
  },
  // 空类 class PVZ1OverwhelmModulePropertiesData，无字段
  "PVZ1OverwhelmModuleProperties": {},
  "SunBombChallengeProperties": {
    "PlantBombExplosionRadius": 25,
    "ZombieBombExplosionRadius": 80,
    "PlantDamage": 1000,
    "ZombieDamage": 500
  },
  "ZombieRushModuleProperties": {
    "TimeCountDown": 120.0,
    "PlantBlackList": []
  },
  "InitialPlantProperties": {
    "InitialPlantPlacements": []
  },
  "InitialPlantEntryProperties": {
    "Plants": []
  },
  "InitialZombieProperties": {
    "InitialZombiePlacements": []
  },
  "InitialGridItemProperties": {
    "InitialGridItemPlacements": []
  },
  "ProtectThePlantChallengeProperties": {
    "MustProtectCount": 0,
    "Plants": []
  },
  "ProtectTheGridItemChallengeProperties": {
    "Description": "",
    "MustProtectCount": 0,
    "GridItems": []
  },
  "MoldColonyChallengeProps": {
    "Description": "",
    "Locations": "RTID(Mold@LevelModules)"
  },
  "ZombiePotionModuleProperties": {
    "InitialPotionCount": 10,
    "MaxPotionCount": 60,
    "PotionSpawnTimer": {
      "Min": 12,
      "Max": 16
    },
    "PotionTypes": []
  },
  "PiratePlankProperties": {
    "PlankRows": []
  },
  "RailcartProperties": {
    "RailcartType": "railcart_cowboy",
    "Railcarts": [],
    "Rails": []
  },
  "PowerTileProperties": {
    "LinkedTiles": []
  },
  "ManholePipelineModuleProperties": {
    "OperationTimePerGrid": 1,
    "DamagePerSecond": 30,
    "PipelineList": []
  },
  // reportError / BrickMapIndex / TunnelSequenceInterval 默认值为 null，已省略
  "TunnelDefendModuleProperties": {
    "Roads": []
  },
  "RoofProperties": {
    "FlowerPotStartColumn": 0,
    "FlowerPotEndColumn": 2
  },
  "TideProperties": {
    "StartingWaveLocation": 0
  },
  "WarMistProperties": {
    "m_iInitMistPosX": 5,
    "m_iNormValX": 1000,
    "m_iBloverEffectInterval": 15
  },
  "LunarMineVeinModuleProperties": {
    "VeinPlacements": []
  },
  "RadiationMeteorModuleProperties": {
    "ResourceGroupNames": [
      "Radiation_meteorite_group"
    ],
    "WarningDuration": 5,
    "PollutionInterval": 5,
    "MiningDurationRequired": 5,
    "PowerRewardOnDestroy": 4,
    "SpawnSchedule": []
  },
  "LevelPowerupModuleProperties": {
    "Powerups": [
      {
        "TypeName": "powerupflickzombie",
        "FreeUseCount": 3
      },
      {
        "TypeName": "powerupwizardfinger",
        "FreeUseCount": 3
      },
      {
        "TypeName": "poweruppinchzombie",
        "FreeUseCount": 3
      }
    ]
  },
  // 空类 class RocketZombieFlickModuleData，无字段
  "RocketZombieFlickModuleProperties": {},
  // NightStartWaveNum / StatueInfos / StatueNightInfos 默认值均为 null，故为 {}
  "RenaiModuleProperties": {},
  "LunarTerminalModuleProperties": {
    "CollectorCooldown": 20
  },
  "MoonLifeSupportSystemProperties": {
    "InitialCapacity": 10,
    "BufferOverloadRatio": 2.0,
    "PenaltyCountdown": 5.0,
    "PlantImmunityList": {
      "List": [
        "lilypad",
        "blover",
        "buduhboom",
        "cherry_bomb",
        "coffeebean",
        "cosmoss",
        "doublesamara",
        "empea",
        "flowerpot",
        "gloombara",
        "goldleaf",
        "grapeshot",
        "gravebuster",
        "heathseeker",
        "hotpotato",
        "hurrikale",
        "imitater",
        "jalapeno",
        "olive",
        "perfumeshroom",
        "powerplant",
        "seaderris",
        "thymewarp",
        "doomshroom"
      ],
      "ListType": "blacklist"
    },
    "ResourceGroupNames": [
      "ZombieArchmageGroup",
      "LunarLifeSupport"
    ]
  },

  // ===================== EventRegistry（26 条） =====================
  //
  // ⚠ 这一条**不是**照抄 Z-Editor，是修过它的 bug。Z-Editor 的工厂写的是
  //   `initialDataFactory = { WaveActionData() }`，但同一个注册项的 summaryProvider
  //   解析的是 `SpawnZombiesFromGroundData` —— 后者多两个非空默认字段：
  //     @SerializedName("ColumnStart") var columnStart: Int = 6
  //     @SerializedName("ColumnEnd")   var columnEnd:   Int = 9
  //   （PvzDataModels.kt:739）。照抄工厂就会插出一个缺列范围的地底出怪对象。
  //   按明显意图改用 SpawnZombiesFromGroundData 的默认值，多出来的两个键游戏本来就认。
  "SpawnZombiesFromGroundSpawnerProps": {
    "ColumnStart": 6,
    "ColumnEnd": 9,
    "Zombies": []
  },
  "SpawnZombiesJitteredWaveActionProps": {
    "Zombies": []
  },
  "FrostWindWaveActionProps": {
    "Winds": []
  },
  "BeachStageEventZombieSpawnerProps": {
    "ColumnStart": 5,
    "ColumnEnd": 9,
    "GroupSize": 1,
    "ZombieCount": 1,
    "ZombieName": "beach",
    "TimeBeforeFullSpawn": 1.0,
    "TimeBetweenGroups": 0.5,
    "WaveStartMessage": ""
  },
  "TidalChangeWaveActionProps": {
    "TidalChange": {
      "ChangeAmount": 0,
      "ChangeType": "absolute"
    }
  },
  "ModifyConveyorWaveActionProps": {
    "Add": [],
    "Remove": []
  },
  "DinoWaveActionProps": {
    "DinoRow": 2,
    "DinoType": "raptor",
    "DinoWaveDuration": 2
  },
  "DinoTreadActionProps": {
    "GridY": 2,
    "GridXMin": 5,
    "GridXMax": 5,
    "TimeInterval": 3,
    "WaveStartMessage": "[WARNING_DINO_TREAD]"
  },
  "DinoRunActionProps": {
    "DinoRow": 0,
    "TimeInterval": 2,
    "WaveStartMessage": "[WARNING_DINO_RUN]"
  },
  "ThunderWaveActionProps": {
    "Thunders": []
  },
  "BungeeWaveActionProps": {
    "zombieName": "tutorial",
    "target": {
      "mX": 0,
      "mY": 0
    },
    "Level": 1
  },
  // PortalColumn / PortalRow 带 @JsonAdapter(FlexibleIntAdapter)，写成字符串
  "SpawnModernPortalsWaveActionProps": {
    "PortalType": "egypt",
    "PortalColumn": "5",
    "PortalRow": "3",
    "SpawnEffect": "",
    "SpawnSoundID": "",
    "IgnoreGraveStone": false
  },
  "StormZombieSpawnerProps": {
    "ColumnStart": 5,
    "ColumnEnd": 9,
    "GroupSize": 1,
    "TimeBetweenGroups": 1,
    "Type": "sandstorm",
    "Zombies": []
  },
  "RaidingPartyZombieSpawnerProps": {
    "GroupSize": 5,
    "SwashbucklerCount": 5,
    "TimeBetweenGroups": 2
  },
  "SpawnRocketLandingWaveActionProps": {
    "RocketPool": [
      {
        "Count": 0,
        "Type": "RTID(rocket_landing@GridItemTypes)"
      }
    ],
    "SpawnPositionsPool": [],
    "SpawnCount": 0,
    "SpawnInterval": 3,
    "DisplacePlants": false,
    "IgnoreGraveStone": true
  },
  "HamsterZombieSpawnerProps": {
    "ColumnStart": 0,
    "ColumnEnd": 8,
    "GroupSize": 1,
    "TimeBetweenGroups": 2,
    "TimeBeforeFullSpawn": 5,
    "Zombies": []
  },
  "ZombiePotionActionProps": {
    "Potions": []
  },
  "SpawnGravestonesWaveActionProps": {
    "GravestonePool": [],
    "SpawnPositionsPool": []
  },
  // WaveStartMessage 默认值为 null，已省略
  "SpawnZombiesFromGridItemSpawnerProps": {
    "ZombieSpawnWaitTime": 0,
    "GridTypes": [],
    "Zombies": []
  },
  "FairyTaleFogWaveActionProps": {
    "MovingTime": 3.0,
    "FogType": "fairy_tale_fog_lvl1",
    "Range": {
      "mX": 4,
      "mY": 0,
      "mWidth": 8,
      "mHeight": 5
    }
  },
  "FairyTaleWindWaveActionProps": {
    "Duration": 5.0,
    "VelocityScale": 2.0
  },
  // 工厂为 ParachuteRainEventData(waveStartMessage = "[WARNING_SPIDERRAIN]")
  "SpiderRainZombieSpawnerProps": {
    "ColumnStart": 5,
    "ColumnEnd": 9,
    "GroupSize": 1,
    "SpiderCount": 1,
    "SpiderZombieName": "",
    "TimeBeforeFullSpawn": 1.0,
    "TimeBetweenGroups": 1.0,
    "ZombieFallTime": 1.0,
    "WaveStartMessage": "[WARNING_SPIDERRAIN]"
  },
  // 工厂为 ParachuteRainEventData(waveStartMessage = "[WARNING_PARACHUTERAIN]")
  "ParachuteRainZombieSpawnerProps": {
    "ColumnStart": 5,
    "ColumnEnd": 9,
    "GroupSize": 1,
    "SpiderCount": 1,
    "SpiderZombieName": "",
    "TimeBeforeFullSpawn": 1.0,
    "TimeBetweenGroups": 1.0,
    "ZombieFallTime": 1.0,
    "WaveStartMessage": "[WARNING_PARACHUTERAIN]"
  },
  // 工厂为 ParachuteRainEventData(waveStartMessage = "[WARNING_BASSRAIN]")
  "BassRainZombieSpawnerProps": {
    "ColumnStart": 5,
    "ColumnEnd": 9,
    "GroupSize": 1,
    "SpiderCount": 1,
    "SpiderZombieName": "",
    "TimeBeforeFullSpawn": 1.0,
    "TimeBetweenGroups": 1.0,
    "ZombieFallTime": 1.0,
    "WaveStartMessage": "[WARNING_BASSRAIN]"
  },
  "BlackHoleWaveActionProps": {
    "ColNumPlantIsDragged": 0
  },
  "WaveActionMagicMirrorTeleportationArrayProps2": {
    "MagicMirrorTeleportationArrays": []
  }
};

/* 以下 ModuleRegistry 条目的 initialDataFactory 为 null，不会创建对象，
 * 因此不在上表中（插入时只往 Modules 数组里加一个 RTID 引用）：
 *   CustomLevelModuleProperties, StandardLevelIntroProperties,
 *   ZombiesAteYourBrainsProperties, ZombiesDeadWinConProperties,
 *   SunDropperProperties, LawnMowerProperties, RainDarkProperties
 */
