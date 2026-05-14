import React from 'react';
import { Composition } from 'remotion';
import { AtlaixLaunchVideo } from './AtlaixLaunchVideo';
import { AtlaixInvestorFilm } from './AtlaixInvestorFilm';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AtlaixLaunch"
        component={AtlaixLaunchVideo}
        durationInFrames={1080}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AtlaixInvestorFilm"
        component={AtlaixInvestorFilm}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
