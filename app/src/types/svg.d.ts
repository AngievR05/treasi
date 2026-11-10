declare module '*.svg' {
  import type { FunctionComponent } from 'react';
  import type { SvgProps } from 'react-native-svg';

  const Svg: FunctionComponent<SvgProps>;
  export default Svg;
}
