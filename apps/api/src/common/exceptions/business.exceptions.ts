import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class EscrowStateException extends BadRequestException {
  constructor(currentState: string, requiredState: string) {
    super({ code: 'ESCROW_STATE_INVALID', message: `Escrow is in ${currentState}. Required: ${requiredState}` });
  }
}

export class MilestonePercentageException extends BadRequestException {
  constructor(total: number) {
    super({ code: 'MILESTONE_PERCENTAGE_INVALID', message: `Milestone percentages total ${total}%. Must equal 100%.` });
  }
}

export class ProjectStateException extends BadRequestException {
  constructor(currentState: string, requiredState: string | string[]) {
    const required = Array.isArray(requiredState) ? requiredState.join(' or ') : requiredState;
    super({ code: 'PROJECT_STATE_INVALID', message: `Project is in ${currentState}. Required: ${required}` });
  }
}

export class MilestoneStateException extends BadRequestException {
  constructor(currentState: string, requiredState: string) {
    super({ code: 'MILESTONE_STATE_INVALID', message: `Milestone is in ${currentState}. Required: ${requiredState}` });
  }
}

export class BoqStateException extends BadRequestException {
  constructor(currentState: string, requiredState: string) {
    super({ code: 'BOQ_STATE_INVALID', message: `BOQ is in ${currentState}. Required: ${requiredState}` });
  }
}

export class DuplicateBidException extends ConflictException {
  constructor() {
    super({ code: 'DUPLICATE_BID', message: 'You have already submitted a bid for this project' });
  }
}

export class ResourceNotFoundException extends NotFoundException {
  constructor(resource: string, id: string) {
    super({ code: 'RESOURCE_NOT_FOUND', message: `${resource} with id ${id} not found` });
  }
}
