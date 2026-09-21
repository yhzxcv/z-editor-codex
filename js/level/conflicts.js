/* 模块冲突规则 —— 移植自 Z-Editor 的 data/repository/ModuleConflictRepository.kt
 *
 * 一条规则 = 一组 objclass；这组**同时存在**时即为冲突。description 是给用户看的
 * 人话解释，直接写在数据里（而不是靠 UI 拼），因为这些都是踩出来的经验。
 *
 * Kotlin 侧原本绑了 Compose 的 ImageVector 做图标，Web 端用不到，已剥掉。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Conflicts = (function () {
  'use strict';

  var Parse = window.ZLevel.Parse;

  var RULES = [
    {
      classes: ['SeedBankProperties', 'ConveyorSeedBankProperties'],
      title: '模块逻辑冲突',
      description: '种子库与传送带模块的ui会相互遮挡，而且有可能闪退，需要确保种子库处于预选模式。'
    },
    {
      classes: ['VaseBreakerPresetProperties', 'StandardLevelIntroProperties'],
      title: '模块逻辑冲突',
      description: '砸罐子模式下不需要添加开局转场动画。'
    },
    {
      classes: ['LastStandMinigameProperties', 'StandardLevelIntroProperties'],
      title: '模块逻辑冲突',
      description: '坚不可摧模式下不需要添加开局转场动画。'
    },
    {
      classes: ['LastStandMinigameProperties', 'ZombossBattleModuleProperties'],
      title: '模块逻辑冲突',
      description: '僵王战需要特殊的僵王战坚不可摧模式开启。'
    },
    {
      classes: ['EvilDaveProperties', 'ZombiesDeadWinConProperties'],
      title: '模块逻辑冲突',
      description: '我是僵尸模式下不能添加僵尸掉落模块。'
    },
    {
      classes: ['EvilDaveProperties', 'ZombiesAteYourBrainsProperties'],
      title: '模块逻辑冲突',
      description: '我是僵尸模式下不能添加僵尸胜利判定。'
    },
    {
      classes: ['ZombossBattleModuleProperties', 'ZombiesDeadWinConProperties'],
      title: '模块逻辑冲突',
      description: '僵王战模式下使用死亡掉落会导致无法正常结算。'
    },
    {
      classes: ['ZombossBattleIntroProperties', 'StandardLevelIntroProperties'],
      title: '模块逻辑冲突',
      description: '两种关卡开局转场不能同时出现，否则僵王血量无法正常显示。'
    },
    {
      classes: ['InitialPlantEntryProperties', 'RoofProperties'],
      title: '模块逻辑冲突',
      description: '在屋顶无法进行预置植物，会引发闪退。'
    },
    {
      classes: ['ProtectThePlantChallengeProperties', 'RoofProperties'],
      title: '模块逻辑冲突',
      description: '在屋顶无法进行预置植物，会引发闪退。'
    },
    {
      classes: ['CustomLevelModuleProperties', 'LawnMowerProperties'],
      title: '模块逻辑冲突',
      description: '庭院模块下使用小推车无效。'
    }
  ];

  /**
   * 检查一组对象里的模块冲突。
   * objects 传对象数组，或直接传 objclass 字符串数组（便于测试）。
   * 返回命中的规则列表，每项带上**实际命中的那些 objclass**（规则本身可能有 3 个以上）。
   */
  function check(objects) {
    var present = new Set();
    (Array.isArray(objects) ? objects : []).forEach(function (o) {
      var cls = typeof o === 'string' ? o : Parse.objClassOf(o);
      if (cls) present.add(cls);
    });

    var hits = [];
    RULES.forEach(function (rule) {
      var all = rule.classes.every(function (c) { return present.has(c); });
      if (all) {
        hits.push({
          title: rule.title,
          description: rule.description,
          classes: rule.classes.slice()
        });
      }
    });
    return hits;
  }

  return { RULES: RULES, check: check };
})();
