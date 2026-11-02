output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "region" {
  value = data.aws_region.current.region
}


output "staging_instance" {
  value = {
    id                = aws_instance.staging.id
    name              = aws_instance.staging.tags["Name"]
    instance_type     = aws_instance.staging.instance_type
    availability_zone = aws_instance.staging.availability_zone
    subnet_id         = aws_instance.staging.subnet_id
    private_ip        = aws_instance.staging.private_ip
    public_ip         = aws_instance.staging.public_ip
    security_groups   = aws_instance.staging.vpc_security_group_ids
  }
}

