resource "aws_instance" "staging" {
  ami                    = "ami-0fd9576cca965bd19"
  instance_type          = "t3.small"
  key_name               = "aws-staging-key"
  subnet_id              = "subnet-0627eac1d82f3408a"
  vpc_security_group_ids = ["sg-0d967fe8f777dc65d"]

  tags = {
    Name = "trajetico-staging"
  }

  lifecycle {
    prevent_destroy = true
  }
}
