<template>
  <!-- This component is based on the code from https://markus.oberlehner.net/blog/transition-to-height-auto-with-vue/
  It has been modified to use the vue-property-decorator format
  -->
  <transition
    name="expand"
    @enter="enter"
    @after-enter="afterEnter"
    @leave="leave"
  >
    <slot />
  </transition>
</template>

<script lang="ts">
import { defineComponent } from "vue";


export default defineComponent({
  name: "TransitionExpand",

  emits: ['enter', 'after-enter', 'leave'],

  methods: {
    enter(el: Element) {
      const element = el as HTMLElement;
      const width = getComputedStyle(element).width;

      element.style.width = width;
      element.style.position = "absolute";
      element.style.visibility = "hidden";
      element.style.height = "auto";

      const height = getComputedStyle(element).height;

      element.style.width = "";
      element.style.position = "";
      element.style.visibility = "visible";
      element.style.height = "0px";

      // Force repaint to make sure the
      // animation is triggered correctly.
      getComputedStyle(element).height;

      // Trigger the animation.
      // We use `requestAnimationFrame` because we need
      // to make sure the browser has finished
      // painting after setting the `height`
      // to `0` in the line above.
      requestAnimationFrame(() => {
        element.style.height = height;
      });

      this.$emit('enter');
    },

    afterEnter(el: Element) {
      const element = el as HTMLElement;
      element.style.height = "auto";
      this.$emit('after-enter');
    },

    leave(el: Element) {
      const element = el as HTMLElement;
      const height = getComputedStyle(element).height;

      element.style.height = height;

      // Force repaint to make sure the
      // animation is triggered correctly.
      getComputedStyle(element).height;

      requestAnimationFrame(() => {
        element.style.height = "0";
      });
      this.$emit('leave');
    }
  }
});
</script>

<style scoped>
.expand-enter-active,
.expand-leave-active {
  transition: height 0.2s ease-in-out;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  height: 0;
}
</style>
