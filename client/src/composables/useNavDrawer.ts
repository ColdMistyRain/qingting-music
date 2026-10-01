import { ref } from "vue";

/**
 * 手机端导航抽屉的开合状态（模块级单例，v5.35）。
 *
 * 为什么要单独抽一层：**按钮和面板不在一起**。按钮要跟页头标题同一行（所以它渲染在各页页头里），
 * 而抽屉面板属于外壳（它要盖住整页，不能待在内容岛里）。两处要共享一个布尔状态，
 * 又不能为此把面板塞进页头 —— 于是把状态提到组件之外。
 *
 * 只放一个布尔值，不引 Pinia：这不是业务状态，是纯 UI 状态，且只有一对使用者
 * （`NavToggle` 与 `NavDrawer`）。将来第三个消费者出现（比如手势也要开关它）再升级。
 */
const open = ref(false);

export function useNavDrawer(): {
  open: typeof open;
  show: () => void;
  hide: () => void;
  toggle: () => void;
} {
  return {
    open,
    show: () => {
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
    toggle: () => {
      open.value = !open.value;
    },
  };
}
