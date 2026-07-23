import * as React from 'react';
import { TopRightMenu } from '../../ui/app/TopRightMenu';

type Props = React.ComponentProps<typeof TopRightMenu>;

export function TopRightControls(props: Props) {
  return <TopRightMenu {...props} />;
}
