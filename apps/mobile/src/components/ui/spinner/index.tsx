'use client';
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { tva } from '@gluestack-ui/utils/nativewind-utils';

const spinnerStyle = tva({ base: 'text-primary' });

const Spinner = React.forwardRef<
  React.ComponentRef<typeof ActivityIndicator>,
  React.ComponentProps<typeof ActivityIndicator>
>(function Spinner(
  { className, focusable = false, 'aria-label': ariaLabel = 'loading', ...props },
  ref
) {
  return (
    <ActivityIndicator
      ref={ref}
      focusable={focusable}
      aria-label={ariaLabel}
      {...props}
      className={spinnerStyle({ class: className })}
    />
  );
});

Spinner.displayName = 'Spinner';

export { Spinner };
