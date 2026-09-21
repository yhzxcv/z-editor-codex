/* 保存时的对象排序 —— 移植自 Z-Editor 的 data/ObjectOrderRegistry.kt
 *
 * 这是**保存兼容性的红线**：不按这个顺序写出的文件，游戏读起来会有问题。
 * Kotlin 侧那份是零 import 的纯逻辑，所以能近乎逐行搬过来。
 *
 * 排序规则（comparator）：
 *   1. 两个都在白名单 -> 按白名单顺序；同 objclass 再按首别名自然序
 *      （不比较别名的话，稳定排序会保留插入顺序，波次就会按添加先后而不是序号排）
 *   2. 只有一个在白名单 -> 白名单的排前面
 *   3. 都不在白名单 -> 按 objclass 字母序归类
 *   4. objclass 也一样 -> 按首别名自然序
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Order = (function () {
  'use strict';

  // 顺序即优先级。改动这个列表等于改变落盘结果，非必要不要动。
  var ORDER_LIST = [
    'LevelDefinition',

    'StandardLevelIntroProperties',
    'CustomLevelModuleProperties',
    'LawnMowerProperties',
    'ZombiesDeadWinConProperties',
    'ZombiesAteYourBrainsProperties',

    'SeedBankProperties',
    'ConveyorSeedBankProperties',
    'SeedRainProperties',
    'PennyClassroomModuleProperties',
    'RiftThemeDemoModuleProperties',
    'TimeEnergyModuleProperties',

    'SunDropperProperties',
    'SunBombChallengeProperties',
    'LastStandMinigameProperties',
    'BowlingMinigameProperties',
    'NewBowlingMinigameProperties',
    'SouDaCheDamageTextModuleProperties',

    'MoldColonyChallengeProps',
    'BoardGridMapProps',
    'PiratePlankProperties',
    'TideProperties',
    'RoofProperties',
    'RailcartProperties',
    'PowerTileProperties',
    'TunnelDefendModuleProperties',
    'ZombiePotionModuleProperties',
    'WarMistProperties',
    'RainDarkProperties',
    'RadiationMeteorModuleProperties',
    'ManholePipelineModuleProperties',
    'LunarMineVeinModuleProperties',

    'ZombieMoveFastModuleProperties',
    'ZombieRushModuleProperties',
    'IncreasedCostModuleProperties',
    'DeathHoleModuleProperties',
    'LevelScoringModuleProperties',
    'LevelMutatorStartingPlantfoodProps',
    'LevelMutatorMaxSunProps',
    'LevelMutatorRiftTimedSunProps',
    'RocketZombieFlickModuleProperties',

    'InitialPlantProperties',
    'InitialPlantEntryProperties',
    'InitialZombieProperties',
    'InitialGridItemProperties',
    'ProtectThePlantChallengeProperties',
    'ProtectTheGridItemChallengeProperties',

    'ZombossBattleIntroProperties',
    'ZombossBattleModuleProperties',
    'VaseBreakerPresetProperties',
    'VaseBreakerArcadeModuleProperties',
    'VaseBreakerFlowModuleProperties',
    'PVZ1OverwhelmModuleProperties',
    'EvilDaveProperties',
    'SingleHandedProperties',

    'StarChallengeModuleProperties',

    'StarChallengeBeatTheLevelProps',
    'StarChallengeSaveMowersProps',
    'StarChallengePlantFoodNonuseProps',
    'StarChallengePlantsSurviveProps',
    'StarChallengeZombieDistanceProps',
    'StarChallengeSunProducedProps',
    'StarChallengeSunUsedProps',
    'StarChallengeSpendSunHoldoutProps',
    'StarChallengeKillZombiesInTimeProps',
    'StarChallengeZombieSpeedProps',
    'StarChallengeSunReducedProps',
    'StarChallengePlantsLostProps',
    'StarChallengeSimultaneousPlantsProps',
    'StarChallengeUnfreezePlantsProps',
    'StarChallengeBlowZombieProps',
    'StarChallengeTargetScoreProps',
    'ApplyZombieConditionsChallengeProps',
    'PlantDefeatZombieChallengeProps',

    'PickupCollectableTutorialProperties',

    'MoonLifeSupportSystemProperties',
    'LunarTerminalModuleProperties',
    'RenaiModuleProperties',
    'LevelPowerupModuleProperties',

    'WaveManagerModuleProperties',
    'WaveManagerProperties',

    'ZombieJitterOffsets',
    'SpawnZombiesJitteredWaveActionProps',
    'SpawnZombiesFromGroundSpawnerProps',
    'SpawnZombiesFromGridItemSpawnerProps',
    'BeachStageEventZombieSpawnerProps',
    'BungeeWaveActionProps',

    'StormZombieSpawnerProps',
    'HamsterZombieSpawnerProps',
    'RaidingPartyZombieSpawnerProps',

    'SpiderRainZombieSpawnerProps',
    'ParachuteRainZombieSpawnerProps',
    'BassRainZombieSpawnerProps',

    'SpawnModernPortalsWaveActionProps',
    'FrostWindWaveActionProps',
    'FairyTaleWindWaveActionProps',
    'FairyTaleFogWaveActionProps',
    'DinoWaveActionProps',
    'DinoTreadActionProps',
    'DinoRunActionProps',
    'ThunderWaveActionProps',

    'TidalChangeWaveActionProps',
    'BlackHoleWaveActionProps',
    'WaveActionMagicMirrorTeleportationArrayProps2',

    'ZombiePotionActionProps',
    'SpawnGravestonesWaveActionProps',
    'SpawnRocketLandingWaveActionProps',

    'ModifyConveyorWaveActionProps',

    'ZombieType',
    'ZombiePropertySheet'
  ];

  var ORDER_MAP = {};
  ORDER_LIST.forEach(function (name, i) { ORDER_MAP[name] = i; });

  var UNKNOWN = Number.MAX_SAFE_INTEGER;

  /** 白名单里的顺序号；不在白名单返回一个极大值（排到最后）。 */
  function getPriority(objClass) {
    var p = ORDER_MAP[objClass];
    return p === undefined ? UNKNOWN : p;
  }

  /* 自然序比较：连续数字段按**数值**比（wave2 < wave10），其余按字符码比。
   *
   * Kotlin 用 Long 累加、并在达到 1e17 后停止累加（防溢出）。这里用 BigInt：
   * 1e17 已经超出 JS Number 的精确整数范围（2^53≈9.007e15），照抄 Number 会在
   * 长数字串上悄悄丢精度、排出跟 Kotlin 不一样的结果。阈值语义原样保留。
   */
  var CAP = 100000000000000000n; // 100000000000000000L

  function naturalCompare(s1, s2) {
    var i = 0, j = 0;
    while (i < s1.length && j < s2.length) {
      var c1 = s1[i], c2 = s2[j];
      var d1 = c1 >= '0' && c1 <= '9';
      var d2 = c2 >= '0' && c2 <= '9';
      if (d1 && d2) {
        var num1 = 0n, num2 = 0n;
        while (i < s1.length && s1[i] >= '0' && s1[i] <= '9') {
          if (num1 < CAP) num1 = num1 * 10n + BigInt(s1.charCodeAt(i) - 48);
          i++;
        }
        while (j < s2.length && s2[j] >= '0' && s2[j] <= '9') {
          if (num2 < CAP) num2 = num2 * 10n + BigInt(s2.charCodeAt(j) - 48);
          j++;
        }
        if (num1 !== num2) return num1 < num2 ? -1 : 1;
      } else {
        if (c1 !== c2) return c1 < c2 ? -1 : 1;
        i++; j++;
      }
    }
    // 前缀相同则短的排前面
    return s1.length - s2.length;
  }

  /** 取对象的首别名（没有别名视为空串）。 */
  function firstAlias(obj) {
    var a = obj && obj.aliases;
    return (a && a.length) ? a[0] : '';
  }

  function compareAlias(o1, o2) {
    return naturalCompare(firstAlias(o1), firstAlias(o2));
  }

  /** 排序比较器，直接喂给 Array.prototype.sort。 */
  function comparator(o1, o2) {
    var p1 = getPriority(o1.objclass);
    var p2 = getPriority(o2.objclass);

    if (p1 !== UNKNOWN && p2 !== UNKNOWN) {
      return p1 !== p2 ? p1 - p2 : compareAlias(o1, o2);
    }
    if (p1 !== UNKNOWN) return -1;
    if (p2 !== UNKNOWN) return 1;
    if (o1.objclass !== o2.objclass) {
      return o1.objclass < o2.objclass ? -1 : 1;
    }
    return compareAlias(o1, o2);
  }

  /** 就地排序 objects 数组。返回同一个数组，方便链式调用。 */
  function sortObjects(objects) {
    objects.sort(comparator);
    return objects;
  }

  return {
    ORDER_LIST: ORDER_LIST,
    getPriority: getPriority,
    naturalCompare: naturalCompare,
    comparator: comparator,
    sortObjects: sortObjects
  };
})();
