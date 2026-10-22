import { Module } from '@nestjs/common';
import { CvController } from './cv.controller';

@Module({ controllers: [CvController] })
export class CvModule {}
