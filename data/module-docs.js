/* 模块 / 事件的**键级中文说明** —— 「模块」页浮层键表里那一档人工注释。
 *
 * 打底由 tools/gen-module-docs.mjs 生成，**之后手工维护**：这个脚本不会覆盖
 * 你写的中文（它先读现有文件，写好的原样留着，只补骨架里新冒出来的键）。
 *
 *   window.ZEditor.ModuleDocs[objClass] = {
 *     desc: '可选。整个模块的说明，写了就盖掉 data/modules.js 里那条',
 *     keys: { 键名: '这个键是干什么的' }
 *   }
 *
 * 三条规矩：
 *   1. keys 是**稀疏**的：只写填了中文的键，键名必须跟插入骨架里**一模一样**。
 *      写歪了不会画出假行（浮层的行只来自骨架），但 tools/check.js 的契约闸会报你。
 *   2. `''` 是**有意的空位**：那个键在浮层上就只剩「键名 + 默认值」两格；
 *      整个模块一个键都没填时走 auto 那一档，表底下会写明"这张表是自动读的"。
 *      契约闸不报空位，只报"填了一串空格"（那会画出一行看着空着的说明）。
 *   3. 键名和默认值**不要抄到这里来**：页面直接读 data/module-skeletons.js，
 *      抄一份就等于多一个会跟骨架分叉的副本 —— 那正是这套东西要避免的事。
 *
 * 改完跑 `node tools/check.js`。键名抄错、挂到不存在的模块上，那里会报。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.ModuleDocs = {

  // ===== 基础模块 —— 每个关卡几乎都要有的：波次、种子库、阳光、小推车、胜负判定 =====

  // 波次管理器 —— 管理关卡的波次事件总配置（2 个键）
  WaveManagerModuleProperties: {
    keys: {
      DynamicZombies: '',
      WaveManagerProps: '',
    }
  },

  // 波次容器 —— 装着波次列表和倒计时参数的对象，波次管理器用 WaveManagerProps 指着它（8 个键）
  WaveManagerProperties: {
    keys: {
      FlagWaveInterval: '',
      MaxNextWaveHealthPercentage: '',
      MinNextWaveHealthPercentage: '',
      WaveCount: '',
      Waves: '',
      ZombieCountDownFirstWaveConveyorSecs: '',
      ZombieCountDownFirstWaveSecs: '',
      ZombieCountDownHugeWaveDelay: '',
    }
  },

  // 种子库 —— 预设卡槽植物与选卡方式（5 个键）
  SeedBankProperties: {
    keys: {
      PresetPlantList: '',
      PlantWhiteList: '',
      PlantBlackList: '',
      SelectionMethod: '',
      OverrideSeedSlotsCount: '',
    }
  },

  // 传送带 —— 预设传送带植物种类和权重（3 个键）
  ConveyorSeedBankProperties: {
    keys: {
      InitialPlantList: '',
      DropDelayConditions: '',
      SpeedConditions: '',
    }
  },

  // ===== 增强模块 —— 在基础之上叠加规则：阳光上限、初始能量豆、通货膨胀、加速进场…… =====

  // 植物阶级 —— 全局定义植物阶级，能覆盖其他模块（1 个键）
  PennyClassroomModuleProperties: {
    keys: {
      PlantMap: '',
    }
  },

  // 阳光上限 —— 覆盖关卡最大阳光存储值（4 个键）
  LevelMutatorMaxSunProps: {
    keys: {
      MaxSunOverride: '',
      DifficultyProps: '',
      IconImage: '',
      IconText: '',
    }
  },

  // 初始能量豆 —— 覆盖关卡开始时的能量豆数量（4 个键）
  LevelMutatorStartingPlantfoodProps: {
    keys: {
      StartingPlantfoodOverride: '',
      DifficultyProps: '',
      IconImage: '',
      IconText: '',
    }
  },

  // 挑战模块 —— 设置关卡的限制条件与挑战目标（2 个键）
  StarChallengeModuleProperties: {
    keys: {
      ChallengesAlwaysAvailable: '',
      Challenges: '',
    }
  },

  // 积分模块 —— 启用积分模块，杀死僵尸获得分数（4 个键）
  LevelScoringModuleProperties: {
    keys: {
      PlantBonusMultiplier: '',
      PlantBonuses: '',
      ScoringRulesType: '',
      StartingPlantfood: '',
    }
  },

  // 伤害显示 —— 启用搜打撤模式的伤害显示（0 个键）
  SouDaCheDamageTextModuleProperties: {
    keys: {
    }
  },

  // 通货膨胀 —— 植物阳光价格随种植次数递增（2 个键）
  IncreasedCostModuleProperties: {
    keys: {
      BaseCostIncreased: '',
      MaxIncreasedCount: '',
    }
  },

  // 遗落坑洞 —— 植物消失后留下不可种植的坑洞（1 个键）
  DeathHoleModuleProperties: {
    keys: {
      LifeTime: '',
    }
  },

  // 加速进场 —— 僵尸入场时快速移动一段距离（2 个键）
  ZombieMoveFastModuleProperties: {
    keys: {
      StopColumn: '',
      SpeedUp: '',
    }
  },

  // 捡取教程 —— 击败特定僵尸弹出对话教程（4 个键）
  PickupCollectableTutorialProperties: {
    keys: {
      DropperZombieType: '',
      LootType: '',
      PostPickupAdvice: '',
      PickupAdvice: '',
    }
  },

  // 追击阳光掉落 —— 击败僵尸掉落阳光（5 个键）
  LevelMutatorRiftTimedSunProps: {
    keys: {
      DifficultyProps: '',
      IconImage: '',
      IconText: '',
      SunDrops: '',
      InvalidPlantTypes: '',
    }
  },

  // 追击主题配置 —— 在关卡中配置回忆或追击的主题（1 个键）
  RiftThemeDemoModuleProperties: {
    keys: {
      DemoRiftThemeName: '',
    }
  },

  // ===== 玩法模式 —— 整关换一种玩法：砸罐子、我是僵尸、坚不可摧、种子雨、保龄球…… =====

  // 沙滩保龄球 —— 设置禁种线以及禁用铲子（1 个键）
  BowlingMinigameProperties: {
    keys: {
      BowlingFoulLine: '',
    }
  },

  // 坚果保龄球 —— 在固定位置绘制保龄球警戒线（0 个键）
  NewBowlingMinigameProperties: {
    keys: {
    }
  },

  // 罐子布局 —— 配置罐子的内容，需要另外两个模块支持（6 个键）
  VaseBreakerPresetProperties: {
    keys: {
      MinColumnIndex: '',
      MaxColumnIndex: '',
      NumColoredPlantVases: '',
      NumColoredZombieVases: '',
      GridSquareBlacklist: '',
      Vases: '',
    }
  },

  // 砸罐子模式 —— 开启砸罐子模式的基础环境与UI支持（0 个键）
  VaseBreakerArcadeModuleProperties: {
    keys: {
    }
  },

  // 砸罐子动画 —— 控制砸罐子开始前罐子掉下来的动画（0 个键）
  VaseBreakerFlowModuleProperties: {
    keys: {
    }
  },

  // 我是僵尸模式 —— 启用我是僵尸模式，需配置僵尸卡槽和预置植物（1 个键）
  EvilDaveProperties: {
    keys: {
      PlantDistance: '',
    }
  },

  // 僵王战模式 —— 配置僵王战模式参数以及僵王种类（6 个键）
  ZombossBattleModuleProperties: {
    keys: {
      ReservedColumnCount: '',
      ZombossMechType: '',
      ZombossStageCount: '',
      ZombossDeathRow: '',
      ZombossDeathColumn: '',
      ZombossSpawnGridPosition: '',
    }
  },

  // 僵王转场 —— 控制Boss战前的过场动画与血条显示（6 个键）
  ZombossBattleIntroProperties: {
    keys: {
      PanStartOffset: '',
      PanEndOffset: '',
      PanRightDuration: '',
      PanLeftDuration: '',
      ZombossPhaseCount: '',
      SkipShowingStreetBossBattle: '',
    }
  },

  // 单枪匹马 —— 配置单枪匹马小游戏基础属性（12 个键）
  SingleHandedProperties: {
    keys: {
      ResourceGroupNames: '',
      InitWeapon: '',
      InitWeaponLaunchTimePercent: '',
      MissileCount: '',
      MissileInterval: '',
      RocketHitTime: '',
      RocketSpeed: '',
      TimeSpeed: '',
      ZombiesWalkSpeed: '',
      ZombiesHitpointsPercent: '',
      DropWeaponDatas: '',
      SpecialWaveDatas: '',
    }
  },

  // 种子雨 —— 控制植物、僵尸或能量豆从天而降（2 个键）
  SeedRainProperties: {
    keys: {
      RainInterval: '',
      SeedRains: '',
    }
  },

  // 坚不可摧 —— 设置初始资源，开启布阵阶段（2 个键）
  LastStandMinigameProperties: {
    keys: {
      StartingSun: '',
      StartingPlantfood: '',
    }
  },

  // 排山倒海 —— 排山倒海小游戏，需配合传送带（0 个键）
  PVZ1OverwhelmModuleProperties: {
    keys: {
    }
  },

  // 太阳炸弹 —— 配置掉落的太阳爆炸范围和伤害（4 个键）
  SunBombChallengeProperties: {
    keys: {
      PlantBombExplosionRadius: '',
      ZombieBombExplosionRadius: '',
      PlantDamage: '',
      ZombieDamage: '',
    }
  },

  // 关卡倒计时 —— 倒计时结束后关卡直接结算（2 个键）
  ZombieRushModuleProperties: {
    keys: {
      TimeCountDown: '',
      PlantBlackList: '',
    }
  },

  // ===== 场景设施 —— 往地图上放东西：预置植物/僵尸/障碍物、矿车轨道、能量瓷砖、屋顶、潮水…… =====

  // 旧版预置植物 —— 预置植物传统写法，可放置冰封植物（1 个键）
  InitialPlantProperties: {
    keys: {
      InitialPlantPlacements: '',
    }
  },

  // 预置植物 —— 关卡开始时场上已存在的植物（1 个键）
  InitialPlantEntryProperties: {
    keys: {
      Plants: '',
    }
  },

  // 预置僵尸 —— 关卡开始时场上已存在的僵尸（1 个键）
  InitialZombieProperties: {
    keys: {
      InitialZombiePlacements: '',
    }
  },

  // 预置障碍物 —— 关卡开始时场上已存在的障碍物（1 个键）
  InitialGridItemProperties: {
    keys: {
      InitialGridItemPlacements: '',
    }
  },

  // 保护植物挑战 —— 设置关卡中必须保护的植物（2 个键）
  ProtectThePlantChallengeProperties: {
    keys: {
      MustProtectCount: '',
      Plants: '',
    }
  },

  // 保护物品挑战 —— 设置关卡中必须保护且不能被破坏的物品（3 个键）
  ProtectTheGridItemChallengeProperties: {
    keys: {
      Description: '',
      MustProtectCount: '',
      GridItems: '',
    }
  },

  // 霉菌区域 —— 设置关卡中禁止种植的霉菌覆盖区域（2 个键）
  MoldColonyChallengeProps: {
    keys: {
      Description: '',
      Locations: '',
    }
  },

  // 僵尸药水 —— 配置黑暗时代药水自动生成机制（4 个键）
  ZombiePotionModuleProperties: {
    keys: {
      InitialPotionCount: '',
      MaxPotionCount: '',
      PotionSpawnTimer: '',
      PotionTypes: '',
    }
  },

  // 海盗甲板 —— 配置海盗地图的甲板行数（1 个键）
  PiratePlankProperties: {
    keys: {
      PlankRows: '',
    }
  },

  // 矿车轨道 —— 配置矿车与轨道初始布局（3 个键）
  RailcartProperties: {
    keys: {
      RailcartType: '',
      Railcarts: '',
      Rails: '',
    }
  },

  // 能量瓷砖 —— 配置能量豆联动效果与瓷砖布局（1 个键）
  PowerTileProperties: {
    keys: {
      LinkedTiles: '',
    }
  },

  // 地下管道 —— 配置蒸汽时代的地下传输管道（3 个键）
  ManholePipelineModuleProperties: {
    keys: {
      OperationTimePerGrid: '',
      DamagePerSecond: '',
      PipelineList: '',
    }
  },

  // 地宫坑道 —— 设置地宫秘境的地道（1 个键）
  TunnelDefendModuleProperties: {
    keys: {
      Roads: '',
    }
  },

  // 屋顶花盆 —— 配置屋顶关卡的预置花盆列数（2 个键）
  RoofProperties: {
    keys: {
      FlowerPotStartColumn: '',
      FlowerPotEndColumn: '',
    }
  },

  // 潮水系统 —— 开启关卡中的潮水系统，需最后添加（1 个键）
  TideProperties: {
    keys: {
      StartingWaveLocation: '',
    }
  },

  // 迷雾系统 —— 设置战场迷雾覆盖范围与交互（3 个键）
  WarMistProperties: {
    keys: {
      m_iInitMistPosX: '',
      m_iNormValX: '',
      m_iBloverEffectInterval: '',
    }
  },

  // 月球矿脉 —— 在月球基地地图上放置矿脉并设置出现波次（1 个键）
  LunarMineVeinModuleProperties: {
    keys: {
      VeinPlacements: '',
    }
  },

  // 放射性陨石 —— 配置从天而降的放射性陨石及其降落参数（6 个键）
  RadiationMeteorModuleProperties: {
    keys: {
      ResourceGroupNames: '',
      WarningDuration: '',
      PollutionInterval: '',
      MiningDurationRequired: '',
      PowerRewardOnDestroy: '',
      SpawnSchedule: '',
    }
  },

  // ===== 特殊模块 —— 单个关卡的专属机制：金手指、复兴雕像、月球基地…… =====

  // 金手指 —— 配置关卡内可免费使用的手势技能（1 个键）
  LevelPowerupModuleProperties: {
    keys: {
      Powerups: '',
    }
  },

  // 火箭筒手势响应 —— 让火箭筒小鬼僵尸响应手指划走的动作（0 个键）
  RocketZombieFlickModuleProperties: {
    keys: {
    }
  },

  // 复兴雕像 —— 配置昼夜交替，让复兴圆环正常工作（0 个键）
  RenaiModuleProperties: {
    keys: {
    }
  },

  // 月球基地采集器 —— 配置月球基地采集器冷却时间（1 个键）
  LunarTerminalModuleProperties: {
    keys: {
      CollectorCooldown: '',
    }
  },

  // 月球电力维持系统 —— 配置月球电力体系参数与免疫植物名单（5 个键）
  MoonLifeSupportSystemProperties: {
    keys: {
      InitialCapacity: '',
      BufferOverloadRatio: '',
      PenaltyCountdown: '',
      PlantImmunityList: '',
      ResourceGroupNames: '',
    }
  },

  // ===== 出怪事件 —— 往某一波里塞僵尸：普通出怪、地底出怪、蹦极投放、空降…… =====

  // 地底出怪 —— 从地下生成僵尸的出怪事件（3 个键）
  SpawnZombiesFromGroundSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      Zombies: '',
    }
  },

  // 普通出怪 —— 最基础的自然出怪事件（1 个键）
  SpawnZombiesJitteredWaveActionProps: {
    keys: {
      Zombies: '',
    }
  },

  // 寒风侵袭 —— 在指定行吹起寒风冻结植物（1 个键）
  FrostWindWaveActionProps: {
    keys: {
      Winds: '',
    }
  },

  // 退潮突袭 —— 僵尸在退潮时浮现突袭（8 个键）
  BeachStageEventZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      ZombieCount: '',
      ZombieName: '',
      TimeBeforeFullSpawn: '',
      TimeBetweenGroups: '',
      WaveStartMessage: '',
    }
  },

  // 蹦极投放 —— 由蹦极僵尸投放一只僵尸到场内（3 个键）
  BungeeWaveActionProps: {
    keys: {
      zombieName: '',
      target: '',
      Level: '',
    }
  },

  // 风暴突袭 —— 沙尘暴或暴风雪运送僵尸（6 个键）
  StormZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      TimeBetweenGroups: '',
      Type: '',
      Zombies: '',
    }
  },

  // 海盗登船 —— 生成若干个飞索僵尸的事件（3 个键）
  RaidingPartyZombieSpawnerProps: {
    keys: {
      GroupSize: '',
      SwashbucklerCount: '',
      TimeBetweenGroups: '',
    }
  },

  // 僵尸仓鼠球 —— 滚动仓鼠球将僵尸带入场地（6 个键）
  HamsterZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      TimeBetweenGroups: '',
      TimeBeforeFullSpawn: '',
      Zombies: '',
    }
  },

  // 障碍物出怪 —— 从指定的障碍物种类生成僵尸（3 个键）
  SpawnZombiesFromGridItemSpawnerProps: {
    keys: {
      ZombieSpawnWaitTime: '',
      GridTypes: '',
      Zombies: '',
    }
  },

  // 小鬼空降 —— 僵尸依靠降落伞从天而降（9 个键）
  SpiderRainZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      SpiderCount: '',
      SpiderZombieName: '',
      TimeBeforeFullSpawn: '',
      TimeBetweenGroups: '',
      ZombieFallTime: '',
      WaveStartMessage: '',
    }
  },

  // 降落伞空降 —— 僵尸依靠降落伞从天而降（9 个键）
  ParachuteRainZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      SpiderCount: '',
      SpiderZombieName: '',
      TimeBeforeFullSpawn: '',
      TimeBetweenGroups: '',
      ZombieFallTime: '',
      WaveStartMessage: '',
    }
  },

  // 贝斯/喷射空降 —— 贝斯手或喷射器僵尸从天而降（9 个键）
  BassRainZombieSpawnerProps: {
    keys: {
      ColumnStart: '',
      ColumnEnd: '',
      GroupSize: '',
      SpiderCount: '',
      SpiderZombieName: '',
      TimeBeforeFullSpawn: '',
      TimeBetweenGroups: '',
      ZombieFallTime: '',
      WaveStartMessage: '',
    }
  },

  // ===== 玩法事件 —— 改变关卡状态：潮水变更、传送带变更、恐龙召唤、雷暴、黑洞…… =====

  // 潮水变更 —— 改变潮水位置（1 个键）
  TidalChangeWaveActionProps: {
    keys: {
      TidalChange: '',
    }
  },

  // 传送带变更 —— 动态添加或移除传送带上的卡片（2 个键）
  ModifyConveyorWaveActionProps: {
    keys: {
      Add: '',
      Remove: '',
    }
  },

  // 恐龙召唤 —— 在指定行召唤一只恐龙协助僵尸（3 个键）
  DinoWaveActionProps: {
    keys: {
      DinoRow: '',
      DinoType: '',
      DinoWaveDuration: '',
    }
  },

  // 雷龙踩踏 —— 雷龙踩踏的落点警告事件（5 个键）
  DinoTreadActionProps: {
    keys: {
      GridY: '',
      GridXMin: '',
      GridXMax: '',
      TimeInterval: '',
      WaveStartMessage: '',
    }
  },

  // 龙潮 —— 恐龙沿指定行奔跑冲击的警告事件（3 个键）
  DinoRunActionProps: {
    keys: {
      DinoRow: '',
      TimeInterval: '',
      WaveStartMessage: '',
    }
  },

  // 雷暴 —— 在场地中随机生成雷暴闪电（1 个键）
  ThunderWaveActionProps: {
    keys: {
      Thunders: '',
    }
  },

  // 时空裂缝 —— 在指定位置召唤时空裂缝（6 个键）
  SpawnModernPortalsWaveActionProps: {
    keys: {
      PortalType: '',
      PortalColumn: '',
      PortalRow: '',
      SpawnEffect: '',
      SpawnSoundID: '',
      IgnoreGraveStone: '',
    }
  },

  // 童话迷雾 —— 生成覆盖场地的迷雾（3 个键）
  FairyTaleFogWaveActionProps: {
    keys: {
      MovingTime: '',
      FogType: '',
      Range: '',
    }
  },

  // 童话微风 —— 把场上所有童话迷雾吹走的风（2 个键）
  FairyTaleWindWaveActionProps: {
    keys: {
      Duration: '',
      VelocityScale: '',
    }
  },

  // 黑洞吸引 —— 生成黑洞吸引所有植物（1 个键）
  BlackHoleWaveActionProps: {
    keys: {
      ColNumPlantIsDragged: '',
    }
  },

  // ===== 环境事件 —— 火箭降落、投放药水、生成墓碑、魔镜传送 =====

  // 火箭降落 —— 配置月球基地的火箭降落（6 个键）
  SpawnRocketLandingWaveActionProps: {
    keys: {
      RocketPool: '',
      SpawnPositionsPool: '',
      SpawnCount: '',
      SpawnInterval: '',
      DisplacePlants: '',
      IgnoreGraveStone: '',
    }
  },

  // 投放药水 —— 在场地固定位置强行生成障碍物（1 个键）
  ZombiePotionActionProps: {
    keys: {
      Potions: '',
    }
  },

  // 障碍物生成 —— 在场地的空位处生成障碍物（2 个键）
  SpawnGravestonesWaveActionProps: {
    keys: {
      GravestonePool: '',
      SpawnPositionsPool: '',
    }
  },

  // 魔镜传送 —— 在场地上生成成对的传送门（1 个键）
  WaveActionMagicMirrorTeleportationArrayProps2: {
    keys: {
      MagicMirrorTeleportationArrays: '',
    }
  },

  /* 下面这些模块**没有插入骨架**（引用型：插入时只往 Modules 里挂一条 RTID 引用，
   * 不建对象），所以没有键可以注。要给它们写模块级 desc 的话，本文件照样认：
   *   CustomLevelModuleProperties  庭院模块
   *   StandardLevelIntroProperties  转场动画
   *   ZombiesAteYourBrainsProperties  失败判定
   *   ZombiesDeadWinConProperties  死亡结算
   *   SunDropperProperties  阳光掉落
   *   LawnMowerProperties  小推车
   *   RainDarkProperties  环境天气
   */
};
