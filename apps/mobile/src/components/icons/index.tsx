import { createIcon, Svg } from '@gluestack-ui/core/icon/creator';
import { Path } from 'react-native-svg';

const UserIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path
        d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
});
UserIcon.displayName = 'UserIcon';

const ShieldLockIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9.5 12.5h5v4h-5v-4Z"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10.5 12.5v-1.25a1.5 1.5 0 0 1 3 0v1.25"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
});
ShieldLockIcon.displayName = 'ShieldLockIcon';

const LogOutIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m16 17 5-5-5-5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M21 12H9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
});
LogOutIcon.displayName = 'LogOutIcon';

const ScissorsIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 4 8.12 15.88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14.47 14.48 20 20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8.12 8.12 12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
});
ScissorsIcon.displayName = 'ScissorsIcon';

const BluetoothIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <Path
      d="m7 7 10 10-5 5V2l5 5L7 17"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
});
BluetoothIcon.displayName = 'BluetoothIcon';

const PrinterIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path
        d="M6 9V3h12v6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M6 14h12v7H6v-7Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
});
PrinterIcon.displayName = 'PrinterIcon';

const FamilyIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
});
FamilyIcon.displayName = 'FamilyIcon';

const WhatsAppIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <Path
      d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.16c-.24.68-1.2 1.26-1.97 1.42-.53.11-1.21.2-3.51-.75-2.95-1.22-4.85-4.21-5-4.4-.14-.2-1.19-1.58-1.19-3.02s.75-2.14 1.02-2.43c.27-.29.58-.36.78-.36l.56.01c.18.01.42-.7.66.5.24.58.82 2.01.89 2.16.7.14.12.31.02.51-.9.2-.14.31-.28.48l-.42.49c-.14.14-.28.29-.12.57.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.14.43.12.59-.7.16-.2.68-.79.86-1.06.18-.27.36-.23.61-.14.24.09 1.55.73 1.82.86.27.14.45.2.51.31.07.11.07.64-.17 1.32Z"
      strokeWidth="0"
      fill="currentColor"
    />
  ),
});
WhatsAppIcon.displayName = 'WhatsAppIcon';

/** Sliders: the list's sort and filter sheet. */
const FilterIcon = createIcon({
  Root: Svg,
  viewBox: '0 0 24 24',
  path: (
    <>
      <Path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" strokeWidth="2" strokeLinecap="round" />
      <Path d="M15 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeWidth="2" />
    </>
  ),
});
FilterIcon.displayName = 'FilterIcon';

export {
  BluetoothIcon,
  FilterIcon,
  ScissorsIcon,
  FamilyIcon,
  LogOutIcon,
  PrinterIcon,
  ShieldLockIcon,
  UserIcon,
  WhatsAppIcon,
};
