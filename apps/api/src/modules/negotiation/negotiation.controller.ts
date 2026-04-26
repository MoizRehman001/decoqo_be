import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsString, IsNumber, IsOptional, Min, Max, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NegotiationService } from './negotiation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class SendNegotiationMessageDto {
  @ApiProperty()
  @IsString()
  content: string = '';
}

class SubmitProposalDto {
  @ApiProperty()
  @IsNumber()
  @Min(10000)
  totalQuoteInr: number = 0;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(104)
  timelineWeeks: number = 0;

  @ApiProperty({ enum: ['ECONOMY', 'STANDARD', 'PREMIUM'] })
  @IsEnum(['ECONOMY', 'STANDARD', 'PREMIUM'])
  materialLevel: string = 'STANDARD';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

@ApiTags('negotiation')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class NegotiationController {
  constructor(private readonly negotiationService: NegotiationService) {}

  @Get('projects/:id/negotiation')
  @ApiOperation({ summary: 'Get negotiation thread for project' })
  getThread(@Param('id') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.negotiationService.getThread(projectId, user.sub);
  }

  @Post('projects/:id/negotiation/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send negotiation message (contact info auto-masked)' })
  sendMessage(
    @Param('id') projectId: string,
    @Body() dto: SendNegotiationMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.negotiationService.sendMessage(
      projectId,
      dto.content,
      user.sub,
      user.role as UserRole,
    );
  }

  @Post('projects/:id/negotiation/proposals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Vendor submits revised proposal' })
  submitProposal(
    @Param('id') projectId: string,
    @Body() dto: SubmitProposalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.negotiationService.submitProposal(projectId, user.sub, dto);
  }

  @Post('projects/:id/negotiation/proposals/:proposalId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer accepts proposal' })
  acceptProposal(
    @Param('id') projectId: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.negotiationService.acceptProposal(projectId, proposalId, user.sub);
  }

  @Post('projects/:id/negotiation/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm negotiation complete — both parties must confirm' })
  confirm(@Param('id') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.negotiationService.confirm(projectId, user.sub, user.role as UserRole);
  }
}
