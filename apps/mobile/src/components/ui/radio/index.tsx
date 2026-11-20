'use client';
import React from 'react';
import { createRadio } from '@gluestack-ui/core/radio/creator';
import { Pressable, View, Platform, Text } from 'react-native';
import { tva, useStyleContext } from '@gluestack-ui/utils/nativewind-utils';
import { withStyleContext } from '@gluestack-ui/utils/nativewind-utils';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

const SCOPE = 'Radio';

const UIRadio = createRadio({
  Root: (Platform.OS === 'web'
    ? withStyleContext(View, SCOPE)
    : withStyleContext(Pressable, SCOPE)) as ReturnType<
      typeof withStyleContext<typeof Pressable>
    >,
  Group: View,
  Icon: View,
  Indicator: View,
  Label: Text,
});

const radioStyle = tva({
  base: 'group/radio flex-row justify-start items-center gap-2 web:cursor-pointer data-[disabled=true]:web:cursor-not-allowed data-[disabled=true]:opacity-50',
  variants: {
    size: {
      sm: 'gap-1.5',
      md: 'gap-2',
      lg: 'gap-2',
    },
  },
});

const radioGroupStyle = tva({
  base: 'gap-3',
});

const radioIconStyle = tva({
  base: 'rounded-full bg-primary',
  parentVariants: {
    size: {
      sm: 'h-2 w-2',
      md: 'h-2.5 w-2.5',
      lg: 'h-3 w-3',
    },
  },
});

const radioIndicatorStyle = tva({
  base: 'relative justify-center items-center aspect-square h-4 w-4 shrink-0 rounded-full border-2 border-border data-[checked=true]:border-primary  dark:bg-input/30 shadow-xs web:outline-none web:data-[focus-visible=true]:ring-[3px] web:data-[focus-visible=true]:ring-ring/50 web:data-[focus-visible=true]:border-ring data-[invalid=true]:ring-destructive/20 data-[invalid=true]:border-destructive data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50',
  parentVariants: {
    size: {
      sm: 'h-4 w-4',
      md: 'h-5 w-5',
      lg: 'h-6 w-6',
    },
  },
});

const radioLabelStyle = tva({
  base: 'text-foreground text-sm font-medium web:select-none web:cursor-pointer data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 font-body',
  parentVariants: {
    size: {
      '2xs': 'text-2xs',
      'xs': 'text-xs',
      'sm': 'text-sm',
      'md': 'text-base',
      'lg': 'text-lg',
      'xl': 'text-xl',
      '2xl': 'text-2xl',
      '3xl': 'text-3xl',
      '4xl': 'text-4xl',
      '5xl': 'text-5xl',
      '6xl': 'text-6xl',
    },
  },
});

type IRadioProps = Omit<React.ComponentProps<typeof UIRadio>, 'context'> &
  VariantProps<typeof radioStyle>;
const Radio = React.forwardRef<React.ComponentRef<typeof UIRadio>, IRadioProps>(
  function Radio({ className, size = 'md', ...props }, ref) {
    return (
      <UIRadio
        className={radioStyle({ class: className, size })}
        {...props}
        ref={ref}
        context={{ size }}
      />
    );
  }
);

type IRadioGroupProps = React.ComponentProps<typeof UIRadio.Group> &
  VariantProps<typeof radioGroupStyle>;
const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof UIRadio.Group>,
  IRadioGroupProps
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <UIRadio.Group
      className={radioGroupStyle({ class: className })}
      {...props}
      ref={ref}
    />
  );
});

type IRadioIndicatorProps = React.ComponentProps<typeof UIRadio.Indicator> &
  VariantProps<typeof radioIndicatorStyle>;
const RadioIndicator = React.forwardRef<
  React.ComponentRef<typeof UIRadio.Indicator>,
  IRadioIndicatorProps
>(function RadioIndicator({ className, ...props }, ref) {
  const { size } = useStyleContext(SCOPE);
  return (
    <UIRadio.Indicator
      className={radioIndicatorStyle({
        parentVariants: { size },
        class: className,
      })}
      ref={ref}
      {...props}
    />
  );
});

type IRadioLabelProps = React.ComponentProps<typeof UIRadio.Label> &
  VariantProps<typeof radioIndicatorStyle>;
const RadioLabel = React.forwardRef<
  React.ComponentRef<typeof UIRadio.Label>,
  IRadioLabelProps
>(function RadioLabel({ className, ...props }, ref) {
  const { size } = useStyleContext(SCOPE);
  return (
    <UIRadio.Label
      className={radioLabelStyle({
        parentVariants: { size },
        class: className,
      })}
      ref={ref}
      {...props}
    />
  );
});

type IRadioIconProps = React.ComponentProps<typeof UIRadio.Icon> &
  VariantProps<typeof radioIconStyle>;
const RadioIcon = React.forwardRef<
  React.ComponentRef<typeof UIRadio.Icon>,
  IRadioIconProps
>(function RadioIcon({ className, ...props }, ref) {
  const { size: parentSize } = useStyleContext(SCOPE);

  return (
    <UIRadio.Icon
      {...props}
      ref={ref}
      className={radioIconStyle({
        parentVariants: { size: parentSize },
        class: className,
      })}
    />
  );
});


Radio.displayName = 'Radio';
RadioGroup.displayName = 'RadioGroup';
RadioIndicator.displayName = 'RadioIndicator';
RadioLabel.displayName = 'RadioLabel';
RadioIcon.displayName = 'RadioIcon';

export { Radio, RadioGroup, RadioIndicator, RadioLabel, RadioIcon };
