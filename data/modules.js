/* 模块 / 事件注册表 —— 供编辑器的「模块插入」面板使用。
 *
 * 来源：docs/registry-raw.json（从 Z-Editor 的 data/ModuleDefinitions.kt 抽出）。
 * 分类沿用 Z-Editor 的 ModuleCategory / EventCategory，只把名字换成中文、补了组说明。
 * 因此这是**半自动产物**：结构可以重新生成，但组说明和分组顺序是人工定的，
 * 重跑 tools/gen-modules.mjs 会覆盖掉。要改分组请直接编辑本文件。
 *
 * 字段含义：
 *   objClass       对象自己的 objclass 字段值（不是别名！模块章复制的是别名）
 *   defaultAlias   插入时的默认别名，也是 RTID(...@...) 里那个
 *   defaultSource  CurrentLevel = 对象写进本文件；LevelModules = 只挂一个引用，不建对象
 *   isCore         核心模块，Z-Editor 的选择器里会标出来
 *   allowMultiple  允许同一关卡里存在多个（否则重复插入会被拒绝）
 *   showInSelector false 表示 Z-Editor 默认不展示（追击主题配置），这里照样保留
 *
 * objdata 的初始值不在这里，在 data/module-skeletons.js（按 objClass 查）。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Modules = {
  moduleGroups: [
    { title: '基础模块', note: '每个关卡几乎都要有的：波次、种子库、阳光、小推车、胜负判定', items: [
      { objClass: 'WaveManagerModuleProperties', title: '波次管理器'
        , defaultAlias: 'NewWaves', defaultSource: 'CurrentLevel'
        , desc: '管理关卡的波次事件总配置'
        , isCore: true
      },
      { objClass: 'CustomLevelModuleProperties', title: '庭院模块'
        , defaultAlias: 'DefaultCustomLevel', defaultSource: 'LevelModules'
        , desc: '开启后关卡适配庭院框架'
      },
      { objClass: 'StandardLevelIntroProperties', title: '转场动画'
        , defaultAlias: 'StandardIntro', defaultSource: 'LevelModules'
        , desc: '关卡开始时的摄像机平移'
      },
      { objClass: 'ZombiesAteYourBrainsProperties', title: '失败判定'
        , defaultAlias: 'DefaultZombieWinCondition', defaultSource: 'LevelModules'
        , desc: '僵尸进屋判负的位置'
      },
      { objClass: 'ZombiesDeadWinConProperties', title: '死亡结算'
        , defaultAlias: 'ZombiesDeadWinCon', defaultSource: 'LevelModules'
        , desc: '在僵尸死亡后进行结算'
      },
      { objClass: 'SeedBankProperties', title: '种子库'
        , defaultAlias: 'SeedBank', defaultSource: 'CurrentLevel'
        , desc: '预设卡槽植物与选卡方式'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'ConveyorSeedBankProperties', title: '传送带'
        , defaultAlias: 'ConveyorBelt', defaultSource: 'CurrentLevel'
        , desc: '预设传送带植物种类和权重'
        , isCore: true
      },
      { objClass: 'SunDropperProperties', title: '阳光掉落'
        , defaultAlias: 'DefaultSunDropper', defaultSource: 'LevelModules'
        , desc: '控制天上掉落阳光的频率'
        , isCore: true
      },
      { objClass: 'LawnMowerProperties', title: '小推车'
        , defaultAlias: 'ModernMowers', defaultSource: 'LevelModules'
        , desc: '设置小推车样式，注意在庭院中不生效'
        , isCore: true
      }
    ] },
    { title: '增强模块', note: '在基础之上叠加规则：阳光上限、初始能量豆、通货膨胀、加速进场……', items: [
      { objClass: 'PennyClassroomModuleProperties', title: '植物阶级'
        , defaultAlias: 'PennyClassroom', defaultSource: 'CurrentLevel'
        , desc: '全局定义植物阶级，能覆盖其他模块'
        , isCore: true
      },
      { objClass: 'LevelMutatorMaxSunProps', title: '阳光上限'
        , defaultAlias: 'OverrideMaxSun', defaultSource: 'CurrentLevel'
        , desc: '覆盖关卡最大阳光存储值'
        , isCore: true
      },
      { objClass: 'LevelMutatorStartingPlantfoodProps', title: '初始能量豆'
        , defaultAlias: 'OverrideStartingPlantFood', defaultSource: 'CurrentLevel'
        , desc: '覆盖关卡开始时的能量豆数量'
        , isCore: true
      },
      { objClass: 'StarChallengeModuleProperties', title: '挑战模块'
        , defaultAlias: 'ChallengeModule', defaultSource: 'CurrentLevel'
        , desc: '设置关卡的限制条件与挑战目标'
        , isCore: true
      },
      { objClass: 'LevelScoringModuleProperties', title: '积分模块'
        , defaultAlias: 'LevelScoring', defaultSource: 'CurrentLevel'
        , desc: '启用积分模块，杀死僵尸获得分数'
      },
      { objClass: 'SouDaCheDamageTextModuleProperties', title: '伤害显示'
        , defaultAlias: 'SouDaCheDamageTextModule', defaultSource: 'CurrentLevel'
        , desc: '启用搜打撤模式的伤害显示'
      },
      { objClass: 'IncreasedCostModuleProperties', title: '通货膨胀'
        , defaultAlias: 'IncreasedCostModule', defaultSource: 'CurrentLevel'
        , desc: '植物阳光价格随种植次数递增'
        , isCore: true
      },
      { objClass: 'DeathHoleModuleProperties', title: '遗落坑洞'
        , defaultAlias: 'DeathHoleModule', defaultSource: 'CurrentLevel'
        , desc: '植物消失后留下不可种植的坑洞'
        , isCore: true
      },
      { objClass: 'ZombieMoveFastModuleProperties', title: '加速进场'
        , defaultAlias: 'FastSpeed', defaultSource: 'CurrentLevel'
        , desc: '僵尸入场时快速移动一段距离'
        , isCore: true
      },
      { objClass: 'PickupCollectableTutorialProperties', title: '捡取教程'
        , defaultAlias: 'FirstCoinTutorial', defaultSource: 'CurrentLevel'
        , desc: '击败特定僵尸弹出对话教程'
        , isCore: true
      },
      { objClass: 'LevelMutatorRiftTimedSunProps', title: '追击阳光掉落'
        , defaultAlias: 'OverrideRiftTimedSun', defaultSource: 'CurrentLevel'
        , desc: '击败僵尸掉落阳光'
        , isCore: true
      },
      { objClass: 'RiftThemeDemoModuleProperties', title: '追击主题配置'
        , defaultAlias: 'RiftThemeDemo', defaultSource: 'CurrentLevel'
        , desc: '在关卡中配置回忆或追击的主题'
        , isCore: true, showInSelector: false
      }
    ] },
    { title: '玩法模式', note: '整关换一种玩法：砸罐子、我是僵尸、坚不可摧、种子雨、保龄球……', items: [
      { objClass: 'BowlingMinigameProperties', title: '沙滩保龄球'
        , defaultAlias: 'BowlingBulbMinigame', defaultSource: 'CurrentLevel'
        , desc: '设置禁种线以及禁用铲子'
        , isCore: true
      },
      { objClass: 'NewBowlingMinigameProperties', title: '坚果保龄球'
        , defaultAlias: 'NewBowlingBulbMinigame', defaultSource: 'CurrentLevel'
        , desc: '在固定位置绘制保龄球警戒线'
      },
      { objClass: 'VaseBreakerPresetProperties', title: '罐子布局'
        , defaultAlias: 'VaseBreakerProps', defaultSource: 'CurrentLevel'
        , desc: '配置罐子的内容，需要另外两个模块支持'
      },
      { objClass: 'VaseBreakerArcadeModuleProperties', title: '砸罐子模式'
        , defaultAlias: 'VaseBreakerArcade', defaultSource: 'LevelModules'
        , desc: '开启砸罐子模式的基础环境与UI支持'
      },
      { objClass: 'VaseBreakerFlowModuleProperties', title: '砸罐子动画'
        , defaultAlias: 'VaseBreakerFlow', defaultSource: 'LevelModules'
        , desc: '控制砸罐子开始前罐子掉下来的动画'
      },
      { objClass: 'EvilDaveProperties', title: '我是僵尸模式'
        , defaultAlias: 'EvilDave', defaultSource: 'CurrentLevel'
        , desc: '启用我是僵尸模式，需配置僵尸卡槽和预置植物'
      },
      { objClass: 'ZombossBattleModuleProperties', title: '僵王战模式'
        , defaultAlias: 'ZombossBattle', defaultSource: 'CurrentLevel'
        , desc: '配置僵王战模式参数以及僵王种类'
      },
      { objClass: 'ZombossBattleIntroProperties', title: '僵王转场'
        , defaultAlias: 'ZombossBattleIntro', defaultSource: 'CurrentLevel'
        , desc: '控制Boss战前的过场动画与血条显示'
      },
      { objClass: 'SingleHandedProperties', title: '单枪匹马'
        , defaultAlias: 'SingleHanded', defaultSource: 'CurrentLevel'
        , desc: '配置单枪匹马小游戏基础属性'
      },
      { objClass: 'SeedRainProperties', title: '种子雨'
        , defaultAlias: 'SeedRain', defaultSource: 'CurrentLevel'
        , desc: '控制植物、僵尸或能量豆从天而降'
        , isCore: true
      },
      { objClass: 'LastStandMinigameProperties', title: '坚不可摧'
        , defaultAlias: 'LastStand', defaultSource: 'CurrentLevel'
        , desc: '设置初始资源，开启布阵阶段'
        , isCore: true
      },
      { objClass: 'PVZ1OverwhelmModuleProperties', title: '排山倒海'
        , defaultAlias: 'PVZ1Overwhelm', defaultSource: 'CurrentLevel'
        , desc: '排山倒海小游戏，需配合传送带'
      },
      { objClass: 'SunBombChallengeProperties', title: '太阳炸弹'
        , defaultAlias: 'SunBombs', defaultSource: 'CurrentLevel'
        , desc: '配置掉落的太阳爆炸范围和伤害'
        , isCore: true
      },
      { objClass: 'ZombieRushModuleProperties', title: '关卡倒计时'
        , defaultAlias: 'ZombieRushModule', defaultSource: 'CurrentLevel'
        , desc: '倒计时结束后关卡直接结算'
        , isCore: true
      }
    ] },
    { title: '场景设施', note: '往地图上放东西：预置植物/僵尸/障碍物、矿车轨道、能量瓷砖、屋顶、潮水……', items: [
      { objClass: 'InitialPlantProperties', title: '旧版预置植物'
        , defaultAlias: 'FrozenPlantPlacement', defaultSource: 'CurrentLevel'
        , desc: '预置植物传统写法，可放置冰封植物'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'InitialPlantEntryProperties', title: '预置植物'
        , defaultAlias: 'InitialPlants', defaultSource: 'CurrentLevel'
        , desc: '关卡开始时场上已存在的植物'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'InitialZombieProperties', title: '预置僵尸'
        , defaultAlias: 'FrozenZombiePlacement', defaultSource: 'CurrentLevel'
        , desc: '关卡开始时场上已存在的僵尸'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'InitialGridItemProperties', title: '预置障碍物'
        , defaultAlias: 'GridItemPlacement', defaultSource: 'CurrentLevel'
        , desc: '关卡开始时场上已存在的障碍物'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'ProtectThePlantChallengeProperties', title: '保护植物挑战'
        , defaultAlias: 'ProtectThePlant', defaultSource: 'CurrentLevel'
        , desc: '设置关卡中必须保护的植物'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'ProtectTheGridItemChallengeProperties', title: '保护物品挑战'
        , defaultAlias: 'ProtectTheGridItem', defaultSource: 'CurrentLevel'
        , desc: '设置关卡中必须保护且不能被破坏的物品'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'MoldColonyChallengeProps', title: '霉菌区域'
        , defaultAlias: 'DoNotPlantBeforeLine', defaultSource: 'CurrentLevel'
        , desc: '设置关卡中禁止种植的霉菌覆盖区域'
        , isCore: true
      },
      { objClass: 'ZombiePotionModuleProperties', title: '僵尸药水'
        , defaultAlias: 'ZombiePotions', defaultSource: 'CurrentLevel'
        , desc: '配置黑暗时代药水自动生成机制'
        , isCore: true, allowMultiple: true
      },
      { objClass: 'PiratePlankProperties', title: '海盗甲板'
        , defaultAlias: 'PiratePlanks', defaultSource: 'CurrentLevel'
        , desc: '配置海盗地图的甲板行数'
        , isCore: true
      },
      { objClass: 'RailcartProperties', title: '矿车轨道'
        , defaultAlias: 'Railcarts', defaultSource: 'CurrentLevel'
        , desc: '配置矿车与轨道初始布局'
        , isCore: true
      },
      { objClass: 'PowerTileProperties', title: '能量瓷砖'
        , defaultAlias: 'FutureLinkedTileGroups', defaultSource: 'CurrentLevel'
        , desc: '配置能量豆联动效果与瓷砖布局'
        , isCore: true
      },
      { objClass: 'ManholePipelineModuleProperties', title: '地下管道'
        , defaultAlias: 'ManholePipeline', defaultSource: 'CurrentLevel'
        , desc: '配置蒸汽时代的地下传输管道'
        , isCore: true
      },
      { objClass: 'TunnelDefendModuleProperties', title: '地宫坑道'
        , defaultAlias: 'TunnelDefend', defaultSource: 'CurrentLevel'
        , desc: '设置地宫秘境的地道'
        , isCore: true
      },
      { objClass: 'RoofProperties', title: '屋顶花盆'
        , defaultAlias: 'RoofProps', defaultSource: 'CurrentLevel'
        , desc: '配置屋顶关卡的预置花盆列数'
        , isCore: true
      },
      { objClass: 'TideProperties', title: '潮水系统'
        , defaultAlias: 'Tide', defaultSource: 'CurrentLevel'
        , desc: '开启关卡中的潮水系统，需最后添加'
        , isCore: true
      },
      { objClass: 'WarMistProperties', title: '迷雾系统'
        , defaultAlias: 'WarMist', defaultSource: 'CurrentLevel'
        , desc: '设置战场迷雾覆盖范围与交互'
        , isCore: true
      },
      { objClass: 'RainDarkProperties', title: '环境天气'
        , defaultAlias: 'DefaultSnow', defaultSource: 'LevelModules'
        , desc: '设置关卡的雨雪、雷电等环境特效'
        , isCore: true
      },
      { objClass: 'LunarMineVeinModuleProperties', title: '月球矿脉'
        , defaultAlias: 'LunarMineVeinModule', defaultSource: 'CurrentLevel'
        , desc: '在月球基地地图上放置矿脉并设置出现波次'
        , isCore: true
      },
      { objClass: 'RadiationMeteorModuleProperties', title: '放射性陨石'
        , defaultAlias: 'RadiationMeteorModule', defaultSource: 'CurrentLevel'
        , desc: '配置从天而降的放射性陨石及其降落参数'
        , isCore: true
      }
    ] },
    { title: '特殊模块', note: '单个关卡的专属机制：金手指、复兴雕像、月球基地……', items: [
      { objClass: 'LevelPowerupModuleProperties', title: '金手指'
        , defaultAlias: 'LevelPowerups', defaultSource: 'CurrentLevel'
        , desc: '配置关卡内可免费使用的手势技能'
        , isCore: true
      },
      { objClass: 'RocketZombieFlickModuleProperties', title: '火箭筒手势响应'
        , defaultAlias: 'RocketZombieFlickModule', defaultSource: 'CurrentLevel'
        , desc: '让火箭筒小鬼僵尸响应手指划走的动作'
      },
      { objClass: 'RenaiModuleProperties', title: '复兴雕像'
        , defaultAlias: 'RenaiModule', defaultSource: 'CurrentLevel'
        , desc: '配置昼夜交替，让复兴圆环正常工作'
        , isCore: true
      },
      { objClass: 'LunarTerminalModuleProperties', title: '月球基地采集器'
        , defaultAlias: 'LunarTerminalModule', defaultSource: 'CurrentLevel'
        , desc: '配置月球基地采集器冷却时间'
        , isCore: true
      },
      { objClass: 'MoonLifeSupportSystemProperties', title: '月球电力维持系统'
        , defaultAlias: 'MoonLifeSupportSystemModule', defaultSource: 'CurrentLevel'
        , desc: '配置月球电力体系参数与免疫植物名单'
        , isCore: true
      }
    ] }
  ],

  eventGroups: [
    { title: '出怪事件', note: '往某一波里塞僵尸：普通出怪、地底出怪、蹦极投放、空降……', items: [
      { objClass: 'SpawnZombiesFromGroundSpawnerProps', title: '地底出怪', defaultAlias: 'GroundSpawner', desc: '从地下生成僵尸的出怪事件' },
      { objClass: 'SpawnZombiesJitteredWaveActionProps', title: '普通出怪', defaultAlias: 'Jittered', desc: '最基础的自然出怪事件' },
      { objClass: 'FrostWindWaveActionProps', title: '寒风侵袭', defaultAlias: 'FrostWindEvent', desc: '在指定行吹起寒风冻结植物' },
      { objClass: 'BeachStageEventZombieSpawnerProps', title: '退潮突袭', defaultAlias: 'LowTideEvent', desc: '僵尸在退潮时浮现突袭' },
      { objClass: 'BungeeWaveActionProps', title: '蹦极投放', defaultAlias: 'BungeeActionEvent', desc: '由蹦极僵尸投放一只僵尸到场内' },
      { objClass: 'StormZombieSpawnerProps', title: '风暴突袭', defaultAlias: 'StormEvent', desc: '沙尘暴或暴风雪运送僵尸' },
      { objClass: 'RaidingPartyZombieSpawnerProps', title: '海盗登船', defaultAlias: 'RaidingPartyEvent', desc: '生成若干个飞索僵尸的事件' },
      { objClass: 'HamsterZombieSpawnerProps', title: '僵尸仓鼠球', defaultAlias: 'HamsterBallEvent', desc: '滚动仓鼠球将僵尸带入场地' },
      { objClass: 'SpawnZombiesFromGridItemSpawnerProps', title: '障碍物出怪', defaultAlias: 'GraveSpawner', desc: '从指定的障碍物种类生成僵尸' },
      { objClass: 'SpiderRainZombieSpawnerProps', title: '小鬼空降', defaultAlias: 'SpiderRainEvent', desc: '僵尸依靠降落伞从天而降' },
      { objClass: 'ParachuteRainZombieSpawnerProps', title: '降落伞空降', defaultAlias: 'ParachuteRainEvent', desc: '僵尸依靠降落伞从天而降' },
      { objClass: 'BassRainZombieSpawnerProps', title: '贝斯/喷射空降', defaultAlias: 'BassRainEvent', desc: '贝斯手或喷射器僵尸从天而降' }
    ] },
    { title: '玩法事件', note: '改变关卡状态：潮水变更、传送带变更、恐龙召唤、雷暴、黑洞……', items: [
      { objClass: 'TidalChangeWaveActionProps', title: '潮水变更', defaultAlias: 'TidalChangeEvent', desc: '改变潮水位置' },
      { objClass: 'ModifyConveyorWaveActionProps', title: '传送带变更', defaultAlias: 'ModConveyorEvent', desc: '动态添加或移除传送带上的卡片' },
      { objClass: 'DinoWaveActionProps', title: '恐龙召唤', defaultAlias: 'DinoTimeEvent', desc: '在指定行召唤一只恐龙协助僵尸' },
      { objClass: 'DinoTreadActionProps', title: '雷龙踩踏', defaultAlias: 'DinoTreadEvent', desc: '雷龙踩踏的落点警告事件' },
      { objClass: 'DinoRunActionProps', title: '龙潮', defaultAlias: 'DinoRunEvent', desc: '恐龙沿指定行奔跑冲击的警告事件' },
      { objClass: 'ThunderWaveActionProps', title: '雷暴', defaultAlias: 'ThunderEvent', desc: '在场地中随机生成雷暴闪电' },
      { objClass: 'SpawnModernPortalsWaveActionProps', title: '时空裂缝', defaultAlias: 'PortalEvent', desc: '在指定位置召唤时空裂缝' },
      { objClass: 'FairyTaleFogWaveActionProps', title: '童话迷雾', defaultAlias: 'FairyFogEvent', desc: '生成覆盖场地的迷雾' },
      { objClass: 'FairyTaleWindWaveActionProps', title: '童话微风', defaultAlias: 'WindEvent', desc: '把场上所有童话迷雾吹走的风' },
      { objClass: 'BlackHoleWaveActionProps', title: '黑洞吸引', defaultAlias: 'BlackHoleEvent', desc: '生成黑洞吸引所有植物' }
    ] },
    { title: '环境事件', note: '火箭降落、投放药水、生成墓碑、魔镜传送', items: [
      { objClass: 'SpawnRocketLandingWaveActionProps', title: '火箭降落', defaultAlias: 'RocketLandingEvent', desc: '配置月球基地的火箭降落' },
      { objClass: 'ZombiePotionActionProps', title: '投放药水', defaultAlias: 'PotionEvent', desc: '在场地固定位置强行生成障碍物' },
      { objClass: 'SpawnGravestonesWaveActionProps', title: '障碍物生成', defaultAlias: 'GravestonesEvent', desc: '在场地的空位处生成障碍物' },
      { objClass: 'WaveActionMagicMirrorTeleportationArrayProps2', title: '魔镜传送', defaultAlias: 'MirrorEvent', desc: '在场地上生成成对的传送门' }
    ] }
  ]
};
