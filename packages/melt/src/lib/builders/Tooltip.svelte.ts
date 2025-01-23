import { Synced } from "$lib/Synced.svelte";
import type { MaybeGetter } from "$lib/types";
import { extract } from "$lib/utils/extract";
import { createBuilderMetadata } from "$lib/utils/identifiers";
import { isHtmlElement } from "$lib/utils/is";
import { untrack } from "svelte";
import type { ComputePositionConfig } from "@floating-ui/dom";
import type { HTMLAttributes } from "svelte/elements";
import { on } from "svelte/events";
import { makeHullFromElements } from "$lib/utils/polygon";
import { isPointerInGraceArea } from "$lib/utils/pointer";
import { useEventListener } from "runed";
import { dataAttr } from "$lib/utils/attribute";
import { useFloating } from "$lib/utils/use-floating.svelte";

const metadata = createBuilderMetadata("tooltip", ["trigger", "content", "arrow"]);

type OpenReason = "pointer" | "focus";

export type TooltipProps = {
	/**
	 * If the Tooltip is open.
	 *
	 * When passing a getter, it will be used as source of truth,
	 * meaning that the value only changes when the getter returns a new value.
	 *
	 * Otherwise, if passing a static value, it'll serve as the default value.
	 *
	 * @default false
	 */
	open?: MaybeGetter<boolean | undefined>;

	/**
	 * Called when the value is supposed to change.
	 */
	onOpenChange?: (value: boolean) => void;

	/**
	 * Size of tooltip arrow in pixels.
	 * 
	 * @default 8
	 */
	arrowSize?: MaybeGetter<number | undefined>;

	/**
	 * If `true`, tooltip will close if trigger is pressed.
	 * 
	 * @default true
	 */
	closeOnPointerDown?: MaybeGetter<boolean | undefined>;

	/**
	 * Tooltip open delay in milliseconds.
	 * 
	 * @default 1000
	 */
	openDelay?: MaybeGetter<number | undefined>;

	/**
	 * Tooltip close delay in milliseconds.
	 * 
	 * @default 0
	 */
	closeDelay?: MaybeGetter<number | undefined>;

	/**
	 * Options to be passed to Floating UI's `computePosition`
	 *
	 * @see https://floating-ui.com/docs/computePosition
	 */
	computePositionOptions?: MaybeGetter<Partial<ComputePositionConfig> | undefined>;

	/**
	 * If the popover visibility should be controlled by the user.
	 *
	 * @default false
	 */
	forceVisible?: MaybeGetter<boolean | undefined>;

	/**
	 * If `true`, leaving trigger will close the tooltip.
	 * 
	 * @default false
	 */
	disableHoverableContent?: MaybeGetter<boolean | undefined>;
};

export class Tooltip {
	#ids = metadata.createIds();

	#props!: TooltipProps;
	computePositionOptions = $derived(extract(this.#props.computePositionOptions, {}));
	closeOnPointerDown = $derived(extract(this.#props.closeOnPointerDown, true));
	openDelay = $derived(extract(this.#props.openDelay, 1000));
	closeDelay = $derived(extract(this.#props.closeDelay, 0));
	disableHoverableContent = $derived(extract(this.#props.disableHoverableContent, false));
	arrowSize = $derived(extract(this.#props.arrowSize, 8));
	forceVisible = $derived(extract(this.#props.forceVisible, false));
	#isVisible = $derived(this.open || this.forceVisible);

	#open!: Synced<boolean>;

	#openReason: OpenReason | null  = $state(null);
	#clickedTrigger: boolean = $state(false);
	#isPointerInsideTrigger: boolean = $state(false);
	#isPointerInsideContent: boolean = $state(false);
	#isMouseInTooltipArea: boolean = $state(false);
	#openTimeout: number | null = $state(null);
	#closeTimeout: number | null = $state(null);
	#mounted: boolean = $state(false);

	constructor(props: TooltipProps = {}) {
		this.#open = new Synced({
			value: props.open,
			onChange: props.onOpenChange,
			defaultValue: false
		});
		this.#props = props;

		$effect(() => untrack(() => void (this.#mounted = true)));

		$effect(() => {
			this.open;
			this.#openReason;

			if (!this.open || !(typeof document !== 'undefined')) return;

			return on(document, "mousemove", (e) => untrack(() => {
				const contentEl = document.getElementById(this.#ids.content);
				const triggerEl = document.getElementById(this.#ids.trigger);
				if (!contentEl || !triggerEl) {
					if (this.open) this.#closeTooltip();
					return;
				}

				const polygonElements = this.disableHoverableContent
					? [triggerEl]
					: [triggerEl, contentEl];
				const polygon = makeHullFromElements(polygonElements);

				this.#isMouseInTooltipArea = 
					this.#isPointerInsideContent 
					|| this.#isPointerInsideTrigger 
					|| isPointerInGraceArea(e, polygon);

				if (this.#openReason !== "pointer") return;

				if (!this.#isMouseInTooltipArea) {
					this.#closeTooltip();
				}
			}));
		});
	}

	get open() {
		return this.#open.current;
	}

	set open(value: boolean) {
		this.#open.current = value;
	}

	get #sharedProps() {
		return {
			onfocusout: async () => {
				await new Promise((r) => setTimeout(r));
				const contentEl = document.getElementById(this.#ids.content);
				const triggerEl = document.getElementById(this.#ids.trigger);

				if (
					contentEl?.contains(document.activeElement) ||
					triggerEl?.contains(document.activeElement)
				) {
					return;
				}
				this.open = false;
			},
		};
	}

	get trigger() {
		$effect(() => { 
			const el = document.getElementById(this.#ids.content);
			if (!isHtmlElement(el)) return;

			return () => (this.#isPointerInsideTrigger = false); 
		});

		return {
			[metadata.dataAttrs.trigger]: "",
			id: this.#ids.trigger,
			"aria-describedby": this.#ids.content,
			"data-state": this.open ? "open" : "closed",
			onpointerdown: () => {
				if (!this.closeOnPointerDown) return;
				this.open = false;
				this.#clickedTrigger = true;
				if (this.#openTimeout) {
					window.clearTimeout(this.#openTimeout);
					this.#openTimeout = null;
				}
			},
			onpointerenter: (e) => {
				this.#isPointerInsideTrigger = true;
				if (e.pointerType === "touch") return;
				this.#openTooltip("pointer");
			},
			onpointerleave: (e) => {
				this.#isPointerInsideTrigger = false;
				if (e.pointerType === "touch") return;
				if (this.#openTimeout) {
					window.clearTimeout(this.#openTimeout);
					this.#openTimeout = null;
				}
			},
			onfocus: () => {
				if (this.#clickedTrigger) return;
				this.#openTooltip("focus");
			},
			onblur: () => this.#closeTooltip(true),
			...this.#sharedProps
		} as const satisfies HTMLAttributes<HTMLElement>;
	}

	get content() {
		$effect(() => () => (this.#isPointerInsideContent = false));

		$effect(() => {
			const triggerEl = document.getElementById(this.#ids.trigger);
			const contentEl = document.getElementById(this.#ids.content);

			if (!triggerEl || !contentEl) return;

			useFloating(
				() => triggerEl,
				() => contentEl,
				this.computePositionOptions,
			);
		});

		useEventListener(
			() => document,
			"scroll",
			(e ) => this.#handleScroll(e),
			{ capture: true }
		);

		useEventListener(
			() => document,
			"keydown",
			(e) => {
				if (e.key !== "Escape") return;

				e.preventDefault();
				if (this.#openTimeout) {
					window.clearTimeout(this.#openTimeout);
					this.#openTimeout = null;
				}

				this.open = false;
			},
		);

		return {
			[metadata.dataAttrs.content]: "",
			id: this.#ids.content,
			role: "tooltip",
			hidden: this.#isVisible && this.#mounted ? undefined : true,
			tabindex: -1,
			style: this.#isVisible && this.#mounted ? "" : "display: none;",
			"data-open": dataAttr(this.open),
			onpointerenter: () => {
				this.#isPointerInsideContent = true;
				this.#openTooltip("pointer");
			},
			onpointerleave: () => {
				this.#isPointerInsideContent = false;
			},
			onpointerdown: () => this.#openTooltip("pointer"),
			...this.#sharedProps,
		} as const satisfies HTMLAttributes<HTMLElement>;
	}

	get arrow() {
		return {
			[metadata.dataAttrs.arrow]: "",
			id: this.#ids.arrow,
			"data-arrow": true,
			style: `position: absolute; width: var(--arrow-size, ${this.arrowSize}px); height: var(--arrow-size, ${this.arrowSize}px);`,
		} as const satisfies HTMLAttributes<HTMLElement>;
	}

	#openTooltip(reason: OpenReason) {
		if (this.#closeTimeout) {
			window.clearTimeout(this.#closeTimeout);
			this.#closeTimeout = null;
		}

		if (!this.#openTimeout) {
			this.#openTimeout = window.setTimeout(() => {
				this.open = true;
				this.#openReason = this.#openReason ?? reason;
				this.#openTimeout = null;
			}, this.openDelay);
		}
	}

	#closeTooltip(isBlur?: boolean) {
		if (this.#openTimeout) {
			window.clearTimeout(this.#openTimeout);
			this.#openTimeout = null;
		}

		if (isBlur && this.#isMouseInTooltipArea) {
			this.#openReason = "pointer";
			return;
		}

		if (!this.#closeTimeout) {
			this.#closeTimeout = window.setTimeout(() => {
				this.open = false;
				this.#openReason = null;
				if (isBlur) this.#clickedTrigger = false;
				this.#closeTimeout = null;
			}, this.closeDelay);
		}
	}

	#handleScroll(e: Event) {
		if (!this.open) return;

		const target = e.target;
		if (!(target instanceof Element) && !(target instanceof Document)) return;

		const triggerEl = document.getElementById(this.#ids.trigger);
		if ((triggerEl && target.contains(triggerEl)) || this.open) {
			this.#closeTooltip();
		}
	}
}